import got from 'got';
import path from 'path';
import events from 'events';
import debugModule from 'debug';
import Config from '../Config';
import { attachCORSHeaders } from './headers';
import { getAppAccessToken, refreshAccessToken } from './token';
import { HTTPResponse, CreateCallRequest, MeetingInfo, Call, UserInfo, OrganizerMeetingInfo } from '../interfaces';
import { notifier } from './callback';

const configInstance = new Config();
const config = configInstance.config();
const debug = debugModule('team-link:debug');

export const callIdEmitter = new events.EventEmitter();

export async function createCall (req: CreateCallRequest, res: HTTPResponse): Promise<void> {
    res = attachCORSHeaders({ res });

    const accessToken = await getAppAccessToken();

    const meetingInfo = await createOnlineMeeting();
    const callParameters = await callMeeting(meetingInfo);
    const callId = callParameters.id;

    notifier.once('Call established', () => {
        addParticipants({ callId, userIds: req.body.userIds, accessToken });
    });

    const callIdRequestedCallback = (): void => {
        callIdEmitter.emit('CallId provided', callId, accessToken);
    };

    callIdEmitter.on('CallId requested', callIdRequestedCallback);

    notifier.once('Call terminated', () => {
        callIdEmitter.removeListener('CallId requested', callIdRequestedCallback);
    });

    debug(JSON.stringify(callParameters, null, 4));

    res.send(callParameters);
}

async function createOnlineMeeting (): Promise<MeetingInfo> {
    const accessToken = await refreshAccessToken();

    const createMeetingQuery = `/me/onlineMeetings`;
    const createMeetingURL = path.join(config.apiBaseURL, createMeetingQuery);

    const createMeetingRes = await got.post(createMeetingURL, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        },
        json: {
            'startDateTime': '0001-01-01T00:00:00Z',
            'endDateTime':   '0001-01-01T00:00:00Z'
        }
    });

    const onlineMeeting = JSON.parse(createMeetingRes.body);

    const organizerId = onlineMeeting.participants.organizer.identity.user.id;
    const chatInfo = onlineMeeting.chatInfo;

    return {
        organizerId,
        chatInfo
    };
}

async function callMeeting ({ organizerId, chatInfo }: MeetingInfo): Promise<Call> {
    const organizerMeetingInfo: OrganizerMeetingInfo = populateUsers({ userIds: [organizerId], organizer: true })[0];

    organizerMeetingInfo.allowConversationWithoutHost = true;

    const callMeetingQuery = `/joinCall`;
    const callMeetingURL = path.join(config.mediaModuleURI, callMeetingQuery);

    const callMeetingRes = await got.post(callMeetingURL, {
        json: {
            'ChatInfo':    JSON.stringify(chatInfo),
            'MeetingInfo': JSON.stringify(organizerMeetingInfo),
            'TenantId':    config.tenantId
        }
    });

    const callParameters = JSON.parse(callMeetingRes.body);

    return callParameters;
}

async function addParticipants ({ callId, userIds, accessToken }: { callId: string; userIds: string[]; accessToken: string}): Promise<void> {
    debug(`Adding ${userIds} to call ${callId}`);

    const addParticipantsQuery = `/communications/calls/${callId}/participants/invite`;
    const addParticipantsURL = path.join(config.apiBaseURL, addParticipantsQuery);

    const maxParticipantsPerRequest = 5;

    for (let participantIndex = 0, numParticipants = userIds.length; participantIndex < numParticipants; participantIndex += maxParticipantsPerRequest) {
        const participants = userIds.slice(participantIndex, participantIndex + maxParticipantsPerRequest);

        await got.post(addParticipantsURL, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            },
            json: {
                'participants':  populateUsers({ userIds: participants }),
                'clientContext': config.clientId
            }
        });
    }
}

function populateUsers ({ userIds, organizer = false }: { userIds: string[]; organizer?: boolean }): UserInfo[] | OrganizerMeetingInfo[] {
    const template = (userId: string): UserInfo | OrganizerMeetingInfo => {
        return {
            '@odata.type':                               organizer ? '#microsoft.graph.organizerMeetingInfo' : '#microsoft.graph.invitationParticipantInfo',
            [`${organizer ? 'organizer' : 'identity'}`]: {
                '@odata.type': '#microsoft.graph.identitySet',
                'user':        {
                    '@odata.type':                            '#microsoft.graph.identity',
                    'id':                                     `${userId}`,
                    [`${organizer ? 'tenantId' : 'tenant'}`]: `${config.tenantId}`
                }
            }
        };
    };

    return userIds.map((userId: string) => template(userId));
}
