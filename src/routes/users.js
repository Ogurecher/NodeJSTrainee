module.exports = {
    getUsers: async function getUsers(req, res) {
        const groupQuery = `/groups?$filter=startswith(displayName,'dxdeveloper')&$select=displayName,id`;
        const groupURL = path.join(config.apiBaseURL, groupQuery);
        
        const groupRes = await got(groupURL, {headers: {Authorization: `${config.accessType} ${config.accessToken}`}});
        const group = JSON.parse(groupRes.body).value[0];
    
        const channelQuery = `/teams/${group.id}/channels?$filter=startswith(displayName, 'General')&select=displayName,id`;
        const channelURL = path.join(config.apiBaseURL, channelQuery);
    
        const channelRes = await got(channelURL, {headers: {Authorization: `${config.accessType} ${config.accessToken}`}});
        const channel = JSON.parse(channelRes.body).value[0];
    
        const usersQuery = `/teams/${group.id}/channels/${channel.id}/members`;
        const usersURL = path.join(config.apiBaseURL, usersQuery);
    
        const usersRes = await got(usersURL, {headers: {Authorization: `${config.accessType} ${config.accessToken}`}});
        const users = JSON.parse(usersRes.body).value.map((data) => {
            return {
                displayName: data.displayName,
                id: data.userId
            };
        });
        
        const onlineUsers = []; 
        for (let user of users) {
            const userStatusQuery = `/users/${user.id}/presence`;
            const userStatusURL = path.join(config.apiBaseURL, userStatusQuery);
    
            const userStatusRes = await got(userStatusURL, {headers: {Authorization: `${config.accessType} ${config.accessToken}`}});
            const userStatus = {
                displayName: user.displayName,
                id: user.id,
                status: JSON.parse(userStatusRes.body).availability
            };
    
            if (userStatus.status === 'Available') {
                onlineUsers.push(userStatus);
            };
        };
        console.log(onlineUsers);
    
        res.send(onlineUsers);
    }
};