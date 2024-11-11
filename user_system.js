class User {
    constructor(userId, userName, roles = ['user']) {
        this.userId = userId;
        this.userName = userName;
        this.points = 0; // Initialize points
        this.roles = roles;
        
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
            this.registerUser(userId, userInfo.userName, userInfo.roles); // Register each user
            const user = this.getUser(userId);
            user.points = parseInt(userInfo.points, 10) || 0; // Set user points if available
            user.roles = userInfo.roles;
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
                roles: user.roles
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

    registerUser(userId, userName, roles = ['user']) {
        if (!this.users.has(userId)) {  
            const user = new User(userId, userName, roles);
            this.users.set(userId, user);
            //console.log('admin id is', this.ADMIN_USER_ID);
            if (userId == this.ADMIN_USER_ID && !user.roles.includes('admin')) {
                roles.push('admin'); // Assign admin role
            }
  
            console.log(`Registered user: ${userId} with name: ${userName}\n ${userName}'s roles are: ${roles}`);
            this.saveData(); //save data after registration
        }
    }

    getUser(userId) {
        return this.users.get(userId);
    }

    awardPoints(targetUser, points) {
        if (targetUser) {
            const name = targetUser.userName
            const pointsToAward = parseInt(points, 10);
            if (!isNaN(pointsToAward)){
                targetUser.points += pointsToAward; // Award points to the user
                console.log(`Gave ${pointsToAward} points to ${name}.`)
                //Update the user in the registry
                this.users.set(targetUser.userId, targetUser);
                this.saveData();
            }
            else{
                console.log(`Invalid points value: ${points}`);
            }

        }
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

    getLeaderboard() {
        // Return a sorted list of users by points
        return Array.from(this.users.values())
            .sort((a, b) => b.points - a.points)
            .map((user, index) => `${index + 1}. ${user.userName}: ${user.points}`) // Number the users
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
}

module.exports = { UserRegistry, User};