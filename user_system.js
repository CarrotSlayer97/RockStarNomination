class User {
    constructor(userId, userName, dmId,roles = ['user']) {
        this.userId = userId;
        this.userName = userName;
        this.nominee_pts = 0;
        this.nominator_pts = 0;
        this.points = 0; // Initialize points
        this.roles = roles;
        this.dmId = dmId; //The first place a user messages the chatbot
        this.badges = [];
        
        // Frank's old dm Id: 1472294584322
        //My dm Id: 1471045287938
    }
}

class UserRegistry {
    constructor() {
        this.users = new Map(); // Use a Map to store users by ID
        this.ADMIN_USER_ID = 1609471024;
        this.catalogItems = [
            { name: "Smartfood Popcorn", cost: 50 },
            { name: "CFCC Educator T-Shirt", cost: 100 },
            { name: "CFCC Educator Hoodie", cost: 200 },
            { name: "Date with Justin Bieber", cost: 1000 }
        ];
    }

    load(data) {
        const parsedData = JSON.parse(data); // Parse the JSON data
        for (const userId in parsedData.users) {
            const userInfo = parsedData.users[userId];
            this.registerUser(userId, userInfo.userName, userInfo.dmId, userInfo.roles); // Register each user
            const user = this.getUser(userId);
            user.nominee_pts = parseInt(userInfo.nominee_pts, 10) || 0;
            //console.log("nominee_pts:", user.nominee_pts);
            user.nominator_pts = parseInt(userInfo.nominator_pts, 10) || 0;
            //console.log("nominator_pts:", user.nominator_pts);
            user.points = parseInt(userInfo.points, 10) || 0; // Set user points if available
            user.roles = userInfo.roles;
            user.badges = userInfo.badges || []; //load badges if available
            //this.users.set(userId, user);
            this.saveData();
        }
        console.log("Users loaded successfully.");
    }

    save() {
        const data = {
            users: {}
        };
        this.users.forEach((user, userId) => {
            data.users[userId] = {
                userName: user.userName,
                points: user.points,
                nominee_pts: user.nominee_pts,
                nominator_pts: user.nominator_pts,
                dmId: user.dmId,   
                roles: user.roles,
                badges: user.badges  
            };
        });
        return JSON.stringify(data); // Convert to JSON string for saving
    }

    saveData() {
        const fs = require('fs'); // Import fs module
        try {
            const data = this.save(); // Get user data as JSON string
            fs.writeFileSync('data.pkl', data); // Save to file
            console.log("Data saved successfully");
        } catch (error) {
            console.log("Error saving data: ", error);
        }
    }

    registerUser(userId, userName, dmId, roles = [], badges = []) {
        if (!this.users.has(userId)) {  
            roles = ['user']
            console.log(dmId);
            const user = new User(userId, userName, dmId, roles, badges);
            this.users.set(userId, user);
            if (userId == this.ADMIN_USER_ID && !user.roles.includes('admin')) {
                roles.push('admin'); // Assign admin role
            }
            console.log(`Registered user: ${userId} with name: ${userName}\n ${userName}'s roles are: ${roles}`);
            this.saveData(); //save data after registration
        }
        else {
            // If user already exists, update their information if necessary
            const existingUser = this.getUser(userId);
            existingUser.userName = userName; // Update userName if needed
            existingUser.dmId = dmId; // Update dmId if needed
            existingUser.roles = roles; // Update roles if needed
            this.users.set(userId, existingUser); // Ensure the updated user is set
        }
    }

    getUser(userId) {
        return this.users.get(userId);
    }

    awardPoints(targetUser, manager,points) {
        if (targetUser) {
            const name = targetUser.userName
            const managerName = manager.userName
            const pointsToAward = parseInt(points, 10);
            if (!isNaN(pointsToAward)){
                targetUser.points += pointsToAward; // Award points to the user
                manager.points += 1; // Award points to the manager
                console.log(`Gave ${pointsToAward} points to ${name} and one point to ${managerName}`)
                //Update the user in the registry
                this.users.set(targetUser.userId, targetUser);
                this.saveData();
            }
            else{
                console.log(`Invalid points value: ${points}`);
            }

        }
    }

    nominateUser(nominator, targetUser) {
        targetUser.nominee_pts += 1; //Award points to the nominee
        nominator.nominator_pts += 1 ; //Award points to the nominator

        if (targetUser.nominee_pts === 5 && !targetUser.badges.includes('Rising Star')) {
            targetUser.badges.push('Rising Star');
            console.log(`${targetUser.userName} has been awarded the Rising Star badge!`);
        } 
        else if (targetUser.nominee_pts === 10 && !targetUser.badges.includes('Fan Favorite')) {
            targetUser.badges.push('Fan Favorite');
            console.log(`${targetUser.userName} has been awarded the Fan Favorite badge!`);
        } 
        else if (targetUser.nominee_pts === 20 && !targetUser.badges.includes('Rockstar Legend')) {
            targetUser.badges.push('Rockstar Legend');
            console.log(`${targetUser.userName} has been awarded the Rockstar Legend badge!`);
        }
        this.users.set(targetUser.userId, targetUser);
        this.users.set(nominator.userId, nominator);
        this.saveData();
        //console.log(`got: ${targetUser.nominee_pts} gave: ${nominator.nominator_pts}`)
    }

    buyPrize(user, prize, cost) {
        if (user) {
            if (!isNaN(cost)) {
                if (user.points >= cost) {
                    user.points -= cost; // Deduct points spent
                    console.log(`${user.userName} spent points on ${prize}.`)
                    //Update the user in the registry
                    this.users.set(user.userId, user);
                    this.saveData();
                }
            }

        }
    }

    //  FOR POINTS ONLY
    // getLeaderboard() {
    //     // Return a sorted list of users by points
    //     return Array.from(this.users.values())
    //         .sort((a, b) => b.points - a.points)
    //         .map((user, index) => `${index + 1}. ${user.userName}: ${user.points}`) // Number the users
    //         .join('\n'); // Join the entries with a newline
    // }

    nomineeLeaderboard() {
            // Return a sorted list of users without points
            return Array.from(this.users.values())
                .sort((a, b) => b.nominee_pts - a.nominee_pts) // Sort by nominee points or any other criteria you prefer
                .map((user, index) => 
                    `${index + 1}. ${user.userName}: ${user.nominee_pts} Nominee Points ` // Only show nominee points
                ) // Number the users and include nominee points
                .join('\n'); // Join the entries with a newline
    }

    nominatorLeaderboard() {
        // Return a sorted list of users without points
        return Array.from(this.users.values())
            .sort((a, b) => b.nominator_pts - a.nominator_pts) // Sort by nominator points or any other criteria you prefer
            .map((user, index) => `${index + 1}. ${user.userName}: ${user.nominator_pts} Nominator Points`) // Only show nominator points
            .join('\n'); // Join the entries with a newline
    }

    getCatalog() {
        return this.catalogItems; // Returns the catalogItems array directly
    }

        // Method to promote a user to manager
    promoteUser(targetUser) {
        if (targetUser) {
            if(!targetUser.roles.includes('manager')) {
                targetUser.roles.push('manager'); // Add 'manager' role to the user's roles
                const name = targetUser.userName;
                console.log(`User ${name} has been promoted to manager.`);
                console.log("target user is", targetUser);
                
                //Update the user in the registry
                this.users.set(targetUser.userId, targetUser);
                
                this.saveData();
                console.log(`${name} is now ${targetUser.roles}`)
                }
                else {
                    console.log(`User ${targetUser.userName} is already a manager.`);
                }
        }else {
            console.log(`User not found.`);
        }
    }

    removeUser(targetUser){
        if(targetUser) {
            // this.targetUsers.delete(targetUser.userId); // Remove the user from the Map
            // console.log(`User ${targetUser.userName} has been removed.`);
            // this.saveData(); // Save the updated user data to the file
        }
    }
        
    isManager(userId) {
        const user = this.getUser(userId); // Retrieve the user by ID
        return user ? user.roles.includes('manager') : false; // Check if the user's role is 'manager'
    }

    isAdmin(userId) {
        console.log("admin is", this.ADMIN_USER_ID);
        return userId == this.ADMIN_USER_ID;
    }

    dmId(userId) {
        const user = this.getUser(userId);
        console.log(`Here's dmId ${user.dmId}`);
        return user.dmId;
    
    }

    clearPoints(user){
        user.nominee_pts = 0;
        user.nominator_pts = 0;
        user.points = 0;
        this.users.set(user.userId, user);
        this.saveData();
    }

    clearBadges(user){
        user.badges = [];
        this.users.set(user.userId, user);
        this.saveData();
    }

    minusNomineePt(user){
        user.nominee_pts -= 1;
        this.users.set(user.userId, user);
        this.saveData();
    }

    minusNominatorPt(user){
        user.nominator_pts -= 1;
        this.users.set(user.userId, user);
        this.saveData();
    }

    ptsReset(){
        this.users.forEach(user => {
            this.clearPoints(user);
        });
    }
}


module.exports = { UserRegistry, User};