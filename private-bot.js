require('dotenv').config();

const RingCentral = require('@ringcentral/sdk').SDK;
const express = require('express');
const bp = require('body-parser')
const fs = require('fs');

// read in config parameters from environment, or .env file
const PORT = process.env.PORT;
const RINGCENTRAL_CLIENT_ID       = process.env.RINGCENTRAL_CLIENT_ID_PRIVATE;
const RINGCENTRAL_CLIENT_SECRET   = process.env.RINGCENTRAL_CLIENT_SECRET_PRIVATE;
const RINGCENTRAL_SERVER_URL = process.env.RINGCENTRAL_SERVER_URL;
const RINGCENTRAL_OAUTH_REDIRECT_URI = process.env.RINGCENTRAL_OAUTH_REDIRECT_URI
const WEBHOOKS_DELIVERY_ADDRESS = process.env.WEBHOOKS_DELIVERY_ADDRESS

const TOKEN_TEMP_FILE = '.private-bot-auth';
const SUBSCRIPTION_ID_TEMP_FILE = '.private-bot-subscription';

const app = express();
app.use( bp.json() );
app.use( bp.urlencoded({extended: true}));

  // Instantiate the RingCentral JavaScript SDK
var rcsdk = new RingCentral({
  server: RINGCENTRAL_SERVER_URL,
  clientId: RINGCENTRAL_CLIENT_ID,
  clientSecret: RINGCENTRAL_CLIENT_SECRET,
  redirectUri: RINGCENTRAL_OAUTH_REDIRECT_URI
});

var platform = rcsdk.platform();

//Handles GET requests to our root ngrok address and responds
app.get('/', function(req, res) {
  res.send('Ngrok is working! Path Hit: ' + req.url);
});

// Import necessary modules
const { UserRegistry, User, message } = require('./user_system'); // Assuming you have a similar structure
const ADMIN_USER_ID = 1609471024;
const userRegistry = new UserRegistry(); // Initialize your user registry


//SAVED INFO MANAGEMENT

function loadData() {
  const filePath = 'data.pkl';
  if (fs.existsSync(filePath)) {
  try {
      const data = fs.readFileSync('data.pkl');
      userRegistry.load(data); // Implement load method in UserRegistry
      console.log("Data loaded successfully");
  } catch (error) {
      console.log("Error loading data: ", error);
  }
}
}

// // Save data to file
// function saveData() {
//   try {
//       const data = userRegistry.save(); // Implement save method in UserRegistry
//       fs.writeFileSync('data.pkl', data);
//       console.log("Data saved successfully");
//   } catch (error) {
//       console.log("Error saving data: ", error);
//   }
// }


function main() {
  // Load user data at startup
  loadData();


  // Start ring server
  app.listen(PORT, function() {
    console.log("Bot server listening on port " + PORT);
    loadSavedTokens();
  });
}

const userPoints = {}; // Object to store user points
const userInputStates = {}; //Object to track user input state


// Bot starts/restarts => check if there is a saved token
async function loadSavedTokens(){
  if (fs.existsSync( TOKEN_TEMP_FILE )) {
    console.log( "Load saved access token")
    var savedTokens = JSON.parse( fs.readFileSync( TOKEN_TEMP_FILE ) );
    console.log( "Reuse saved access token")
    await platform.auth().setData( savedTokens );
    if (fs.existsSync( SUBSCRIPTION_ID_TEMP_FILE )){
      var subscriptionId = fs.readFileSync(SUBSCRIPTION_ID_TEMP_FILE)
      checkWebhooksSubscription(subscriptionId)
    }else
      subscribeToEvents()
  }else{
    console.log("Your bot has not been installed or the saved access token was lost!")
    console.log("Login to developers.ringcentral.com, open the bot app and install it by selecting \
    the Bot menu and at the 'General Settings' section, click the 'Add to RingCentral' button.")
    console.log("Note: If the bot was installed, remove it and reinstall to get a new access token")
  }
}


// Oauth handler
// store the access token in a file if token is lost remove and reinstall the bot 
// acess token should be saved in a more secure place and persistent
app.post('/oauth', async function (req, res) {
  console.log("Private bot being installed");
  if (req.body.access_token) {
    res.status(200).send('')
    // Create a token object and set it to the SDK's platform instance.

    // First, we get an empty token object from the platform instance, then we assign the
    // access token, the token type and other fake values to satify the SDK's tokens syntax.
    var tokenObj = platform.auth().data();
    tokenObj.access_token = req.body.access_token;
    tokenObj.token_type = "bearer"
    tokenObj.expires_in = 100000000000;
    tokenObj.refresh_token = 'xxx';
    tokenObj.refresh_token_expires_in = 10000000000;

    // Finally, we set the token object back to the platform instance and also save it to a file
    // for reuse.
    await platform.auth().setData(tokenObj);
    console.log( "Save tokens to a local file for reuse" )
    fs.writeFileSync( TOKEN_TEMP_FILE, JSON.stringify( tokenObj ) )

    console.log("Bot installation done")
    // The bot must subscribe for Team Messaging notifications
    // Cause a second delay to make sure the access token is fully populated
    console.log("Subscribe to Webhooks notification")
    subscribeToEvents()
  }else{
    res.status(401).end()
  }
});


// Initialize user points
async function initializeUser(userId) {
  const userInfo = await getUserInfo(userId);  
    if (!userRegistry.getUser(userId) && userInfo) {
      const firstName = userInfo.contact.firstName;
      const lastName =  userInfo.contact.lastName;
      userRegistry.registerUser(userId, firstName,lastName); // Implement registerUser in UserRegistry
    }  
  }

function isAdmin(userId){
  const user =  userRegistry.getUser(userId); // Assuming inputText contains the userId
  if(user.roles.includes('admin')) {
    return true;
  }
  false;
}

// Get user points
function getUserPoints(userId) {
  return userPoints[userId] || 0; // Return points or 0 if not found
}



// Promote a user to manager
async function promoteUser(userId, groupId, targetUser) {
  console.log(targetUser);
  if (isAdmin(userId)) { // Check if the requester is admin
    await userRegistry.promoteUser(targetUser);
    console.log(`User role after promotion: ${targetUser.roles}`); // Log the role
    //console.log(userRegistry.getUser(targetUser.userId)); // Log the user object from the registry
    await send_message(groupId, `${targetUser.userName} has been promoted to manager status.`);
    console.log(userRegistry.isManager(targetUser.userId));
    userRegistry.saveData();
  }  
  else {
    await send_message(groupId, "You do not have permission to promote users.");
  }
}

async function awardPoints(userId, groupId, targetUser) {
  if (userRegistry.isManager(userId)) {
    await createPointsCard(groupId, targetUser);
  } else {
      send_message(groupId, "You don't have permission to award points.");
  }
}

// Call the main function to start the bot
if (require.main === module) {
  main();
}

// Export the functions
module.exports = {
  initializeUser,
  awardPoints,
  getUserPoints,
  promoteUser
};

async function getUserInfo(userId) {
  try {
      const response = await platform.get(`/restapi/v1.0/account/~/extension/${userId}`);
      const userInfo = await response.json();
      //console.log (userInfo);
      return userInfo;
  } catch (error) {
      console.error("Error retrieving user info:", error);
      return null; // Return null if there was an error
  }
}


// Handles webhook notifications-- invoked when a user sends a message and when
// the bot is added to/removed from a group or a team etc.
app.post('/webhook-callback', async function (req, res) {
  var validationToken = req.get('Validation-Token');

// SET UP
  if (validationToken) {
    console.log('Verifying webhook token.');
    res.setHeader('Validation-Token', validationToken);
  } else if (req.body.event == "/restapi/v1.0/subscription/~?threshold=60&interval=15") {
    console.log("Renewing subscription ID: " + req.body.subscriptionId);
    renewSubscription(req.body.subscriptionId);
  }  

  console.log("Receieved request", req.body);
  // Check if the body and eventType are defined


  if (req.body.body && req.body.body.text) {
    const body = req.body.body;
    const userId = body.creatorId;
    const inputText =  body.text.trim();
    const targetUser =  Array.from(userRegistry.users.values()).find(u => u.userName.toLowerCase() === inputText.toLowerCase());

     
      if (req.body.body.eventType === "PostAdded") {
          console.log("Received user's message: " + body.text);
          // Your logic for handling PostAdded events  
        

        if (targetUser){ 
          await showManageMenu(body.groupId, targetUser);
        }

      // Check if the user is already registered
      if (!userRegistry.getUser(userId)) {
      // Fetch user info from RingCentral
       const userInfo = await getUserInfo(userId);
      if (userInfo) {
        initializeUser(userId);
      } 
      else {
        await send_message(req.body.groupId, "Failed to register user.");
        } 
    } 
  
    if (req.body.ownerId == body.creatorId) {
      console.log("Ignoring message posted by bot.");

    }
  
    else if (body.text == "ping") {
      send_message( body.groupId, "pong" );
      var card = make_hello_world_card(null);
      send_card( body.groupId, card )
    }

    else if (body.text == "manage"){
      send_message(body.groupId, "Whose account do you want to change?")
    }

  //PROMOTE LOGIC
    else if (body.text === "promote_user") { // Handle the promote user button press
      await send_message(body.groupId, "Please enter the username of the user you want to promote:");
    }
  
  //POINTS LOGIC
    else if (body.text === "points") {
      const points = userRegistry.getUser(userId).points;
      await send_message(body.groupId, `You have ${points} points.`);
    } 

    else if (body.text.startsWith("give_points")) {
      //Give points
      const [_, targetUserId, points] = body.text.split(" ");
      if (userRegistry.isManager(userId)) {
        userRegistry.awardPoints(targetUserId, parseInt(points)); // Implement awardPoints in UserRegistry
        await send_message(body.groupId, `Awarded ${points} points to user ${targetUserId}.`);
      } 
      else {
        await send_message(body.groupId, "You don't have permission to give points.");
      } 
    } 
    else if (body.text === "leaderboard") {
      const leaderboard = userRegistry.getLeaderboard(); // Implement getLeaderboard in UserRegistry
      send_message(body.groupId, `🏆 **Leaderboard** 🏆 \n${leaderboard}`);
    } 

    //WELCOME MESSAGE
    else if (body.text == "hello") {
      const userId = body.creatorId; //takes message sender's user id  
      const user = userRegistry.getUser(userId); 
      if (user) {
        const userName = user.userName;
        await send_message(body.groupId, `Greetings, ${userName}! Welcome to the CFCC Points System. \nThe system is a tech-savvy initiative that rewards you for your exceptional performance.`);
        await showMainMenu(body.groupId, userId); 
      } else {
          await send_message(body.groupId, "Registering user.");
      }
    }

    // else {
    //   var message = `I do not understand ${body.text}`
    //   send_message( body.groupId, message )
    // } 
  
  //END OF TEXT COMMANDS

} else {
  console.log("Event type is not recognized:", req.body.body.eventType);
}
} else if (req.body.conversation) {
  
  console.log("Event does not have a body. ");
  console.log("Request body:", JSON.stringify(req.body, null, 2)); // Log the request body
  console.log("Request params:", JSON.stringify(req.params, null, 2)); // Log request parameters
  console.log("Request query:", JSON.stringify(req.query, null, 2)); // Log request query
  
  const actionData = req.body.data;
  const groupId = req.body.conversation.id;
  console.log(actionData);
  if (!actionData || !groupId) {
    return;
  }
  
  if (actionData.path == 'leaderboard') {
    
    console.log("Followed leaderboard path.")
    const leaderboard = userRegistry.getLeaderboard(); // Implement getLeaderboard in UserRegistry
    send_message(groupId, `🏆 **Leaderboard** 🏆 \n${leaderboard}`);
  }
  
//add a request to the manager to type the name of the user they want to award point + how many points they're giving
  else if (actionData.path == 'award-pts') {
    const managerId = req.body.user.extId;
    const targetUser = req.body.data.targetUser;
    const groupId = req.body.conversation.id;
    awardPoints(managerId, groupId, targetUser);
   
     }

  else if (actionData.path == 'manage'){
    const groupId = req.body.conversation.id;
    send_message(groupId, "Whose account do you want to change?")
  }

  else if (actionData.path == 'points'){
    var points = req.body.data.numPoints; 
    const targetUser = req.body.data.targetUser;
    const groupId = req.body.data.groupId;
    userRegistry.awardPoints(targetUser, points);
    send_message(groupId, `You gave ${points} points to ${targetUser.userName}.`);
  }


//add whether or not the user is a manager
  else if (actionData.path == 'user-stats') {
    const userId = actionData.userId; // Assuming userId is passed in actionData
    const user = userRegistry.getUser(userId);
    if (user) {
        send_message(groupId, `${user.userName} has ${user.points} points.`);
    } else {
        send_message(groupId, "User not found.");
    }
  }

//make it so catalog is called elsewhere and is updatable only by managers
  else if (actionData.path == 'catalog') {
    const catalogItems = [
        { name: "Gift Card", cost: 100 },
        { name: "Snack", cost: 50 },
        { name: "T-Shirt", cost: 200 }
    ];
    const catalogMessage = catalogItems.map(item => `${item.name}: ${item.cost} points`).join('\n');
    send_message(groupId, `Available prizes:\n${catalogMessage}`);
  }

  else if (actionData.path == 'view-employees') {
    const employees = Array.from(userRegistry.users.values()).map(user => `${user.userName} (ID: ${user.userId})`).join('\n');
    send_message(groupId, `Registered Employees:\n${employees}`);
  }

  // make it so only admin can promote a user to manager
  else if (actionData.path == 'help') {
    const helpMessage = `
    Here are the commands you can use:
    - **leaderboard**: View the leaderboard.
    - **points**: Check your points.
    - **give_points [userId] [points]**: Award points to a user (Manager only).
    - **promote_user**: Promote a user to manager (Manager only).
    - **catalog**: View available prizes.
    - **view-employees**: List all registered users.
    `;
    send_message(groupId, helpMessage);
  } 

  else if (actionData.path == 'promotion') {
    console.log("promoter");
    console.log(req.body);
    const userId = req.body.user.extId;
    const targetUser = req.body.data.targetUser;
    const groupId = req.body.conversation.id;
    promoteUser(userId, groupId, targetUser);
  }

  //show users the catalog with option to buy items they can afford
  else if (actionData.path == 'pts-store') {
     const userId = actionData.userId; // Assuming userId is passed in actionData
     const user = userRegistry.getUser(userId);
     if (user) {
         // Logic to redeem points, e.g., check if they have enough points
         const itemToRedeem = actionData.item; // Assuming item is passed in actionData
         const itemCost = 100; // Example cost
         if (user.points >= itemCost) {
             user.points -= itemCost; // Deduct points
             send_message(groupId, `You have redeemed ${itemToRedeem}.`);
         } else {
             send_message(groupId, "You don't have enough points to redeem this item.");
          }
      } else {
         send_message(groupId, "User not found.");
     }
   }

}

        //I DON'T THINK I NEED THIS BUT WHO KNOWS

// if (req.body.body.eventType == 'Delete'){
//   console.log('Bot is being uninstalled by a user => clean up resources')
//   // clear local file/database
//   fs.unlinkSync(TOKEN_TEMP_FILE)
//   fs.unlinkSync(SUBSCRIPTION_ID_TEMP_FILE)
// }
// else{
//   // Log event type
// console.log("Event type:", req.body.body.eventType)
// console.log(req.body.body)
// }
  
  
  // End the response
  res.status(200).end();

});


//Function to show the main menu
async function showMainMenu(groupId, userId) {
  const card = createMainMenuCard(userId); // Create the main menu card
  await send_card(groupId, card); // Send the card to the group
}

async function showManageMenu (groupId, targetUser){
  const card = createManageCard(targetUser, groupId);
  await send_card(groupId, card);
}



// Method to Subscribe for events notification.
async function subscribeToEvents(){
  console.log("Subscribing to posts and groups events")
  var subscriptionData = {
    eventFilters: [
      "/restapi/v1.0/glip/posts", // Team Messaging (a.k.a Glip) events.
      "/restapi/v1.0/glip/groups", // Team Messaging (a.k.a Glip) events.
      "/restapi/v1.0/account/~/extension/~", // Subscribe for this event to detect when a bot is installed and uninstalled
      "/restapi/v1.0/subscription/~?threshold=60&interval=15" // For subscription renewal
    ],
    deliveryMode: {
      transportType: "WebHook",
      address: WEBHOOKS_DELIVERY_ADDRESS
    },
    expiresIn: 604799
  };
  try {
    var resp = await platform.post('/restapi/v1.0/subscription', subscriptionData)
    var jsonObj = await resp.json()
    console.log('Team Messaging events notifications subscribed successfully.');
    // Save the subscription id to a file so that we can check its status every time the
    // bot is restarted.
    fs.writeFileSync( SUBSCRIPTION_ID_TEMP_FILE, jsonObj.id )
    console.log('Your bot is ready for conversations ...');
  }catch (e) {
    console.error('Team Messaging events notifications subscription failed. ', e);
    throw e;
  }
}

async function renewSubscription(id) {
  console.log("Auto subscription renewal");
  try {
      // Make a POST request to renew the subscription using the provided ID
      var resp = await platform.post(`/restapi/v1.0/subscription/${id}/renew`);
              
      // Check if the response status is OK (200)
      if (resp.status === 200) {
          // Parse the JSON response
          var jsonObj = await resp.json();
          console.log("Subscription renewed. Next renewal:" + jsonObj.expirationTime);
          return jsonObj; // Return the renewed subscription details
       } else {
          // Handle non-200 responses
          console.error(`Failed to renew subscription. Status: ${resp.status}`);
          var errorResponse = await resp.json();
          console.error("Error details:", errorResponse);
          throw new Error(`Error renewing subscription: ${errorResponse.message}`);
      }
  } catch (error) {
      // Handle any errors that occurred during the request
      console.error("An error occurred while renewing the subscription:", error);
      throw error; // Rethrow the error for further handling if needed
      }
  } 
  

// Check Webhook subscription status
async function checkWebhooksSubscription(subscriptionId) {
  try {
    var resp = await platform.get(`/restapi/v1.0/subscription/${subscriptionId}`)
    var jsonObj = await resp.json()

    if (jsonObj.status == 'Active') {
      console.log("Webhooks subscription is still active.")
      console.log('Your bot is ready for conversations ...');
    }else{
      //Subscription is not active (could be expired or deleted)
      fs.unlinkSync(SUBSCRIPTION_ID_TEMP_FILE)
      console.log("Webhooks subscription status", jsonObj.status)
      console.log("Deleting expired subscription ID from file.");
      fs.unlinkSync(SUBSCRIPTION_ID_TEMP_FILE); // Delete the expired subscription ID
      console.log("Create new Webhooks subscription")
      subscribeToEvents()
    }
  }catch(e) {
    console.error(e.message);
    if (e.message.includes("Resource for parameter [subscriptionId] is not found")) {
      console.log("Subscription ID not found. Deleting from file.");
      fs.unlinkSync(SUBSCRIPTION_ID_TEMP_FILE); // Delete the non-existent subscription ID
      console.log("Creating a new Webhooks subscription.");
      subscribeToEvents(); // Call the method to create a new subscription
    }
  }
}

// This handler is called when a user submits data from an adaptive card
//What happens after button is pushed
app.post('/user-submit', async function (req, res) {
  
  console.log( "Received card event." );
  const body = req.body;

  if (body.data.path == 'points'){
    console.log("yup")
    var points = body.data.numPoints; 
    const targetUser = body.data.targetUser;
    const groupId = body.data.groupId;
    await userRegistry.awardPoints(targetUser, points);
    send_message(groupId, `You awarded ${points} points to user ${targetUser.userName}.`);
  }

  if (body.data.path == 'new-card'){
    var card = make_new_name_card( body.data.hellotext )
    send_card( body.conversation.id, card)
  }
  else if (body.data.path == 'update-card'){
    var card = make_hello_world_card( body.data.hellotext )
    update_card( body.card.id, card )
    }

  // Check if the request is form a button click
  if (body.type =='button_submit'){
    console.log("button clicked:", req.body.data);
    //Acess the action data
    const userId = req.body.user.extId;
    const groupId = req.body.conversation.id;
  
    if (body.data.path == 'award-pts') {

    }
    else if (actionData.path == 'leaderboard') {
      console.log("path followed to leaderboard")
      const leaderboard = userRegistry.getLeaderboard(); // Implement getLeaderboard in UserRegistry
      send_message(groupId, `🏆 Leaderboard: ${leaderboard}`);
    }
    else if (body.data.path == 'user-stats'){

    }
    else if (body.data.path == 'catalog') {

    }
    else if (body.data.path == 'view-employees') {
    
    }
    else if (body.data.path == 'help') {
    
    }
    else if (body.data.path == 'promotion') {
    
    }
    else if (body.data.path == 'pts-store') {

    }
  }

  res.status(200).end();
});

// Post a message to a chat
async function send_message( groupId, message ) {
  console.log("Posting response to group: " + groupId);
  try {
    var resp = await platform.post(`/restapi/v1.0/glip/chats/${groupId}/posts`, {
      "text": message
    })
  }catch(e) {
    console.log(e)
  }
}

// Send an adaptive card to a chat
async function send_card(groupId, card) {
  console.log("Posting a card to group: " + groupId);
  try {
    var resp = await platform.post(`/restapi/v1.0/glip/chats/${groupId}/adaptive-cards`, card )
  } catch (e) {
      console.log(e);
  }
}

// Update an adaptive card
async function update_card( cardId, card ) {
  console.log("Updating card...");
  try {
    var resp = await platform.put(`/restapi/v1.0/glip/adaptive-cards/${cardId}`, card)
  }catch (e) {
    console.log(e.message)
  }
}

function make_hello_world_card(name) {
  var card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.3",
    body: [
      {
        type: "TextBlock",
        size: "Medium",
        weight: "Bolder",
        text: "Hello World"
      },
      {
        type: "TextBlock",
        text: "Enter your name in the field below so that I can say hello.",
        wrap: true
      },
      {
        type: "Input.Text",
        id: "hellotext",
        placeholder: "Enter your name"
      },
      {
        type: "ActionSet",
        actions: [
          {
            type: "Action.Submit",
            title: "Send a new card",
            data: {
              path: "new-card"
            }
          },
          {
            type: "Action.Submit",
            title: "Update this card",
            data: {
              path: "update-card"
            }
          }
        ]
      }
    ]
  }
  if (name){
    card.body.push({
      type: "Container",
      separator: true,
      items: [
        {
          type: "TextBlock",
          text: `Hello ${name}`,
          wrap: true
        }
      ]
    })
  }
  return card
}

function make_new_name_card(name) {
  return {
    "type": "AdaptiveCard",
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "version": "1.3",
    "body": [
      {
        "type": "TextBlock",
        "size": "Medium",
        "weight": "Bolder",
        "text": "Hello World"
      },
      {
        "type": "TextBlock",
        "text": `Hello ${name}`,
        "wrap": true
      }
    ]
    }
  }
  function createMainMenuCard(userId, groupId) {
    const user = userRegistry.getUser(userId);
    const isManager = userRegistry.isManager(userId);

    const actions = isManager ? [
        { type: "Action.Submit", title: "Manage an Employee", data: { action: "manage", path: "manage", groupId: groupId }  },
        { type: "Action.Submit", title: "View Leaderboard", data: { action: "view_leaderboard", path: "leaderboard" } },
        { type: "Action.Submit", title: "Employee List", data: { action: "employee_list", path: "view-employees" } },
        { type: "Action.Submit", title: "Help", data: { action: "system_functions", path: "help" } }
    ] : [
        { type: "Action.Submit", title: "My Status", data: { action: "my_status", path: "user-stats" } },
        { type: "Action.Submit", title: "Available Prizes", data: { action: "available_prizes", path: "catalog" } },
        { type: "Action.Submit", title: "View Leaderboard", data: { action: "view_leaderboard", path: "leaderboard" } },
        { type: "Action.Submit", title: "Spend Points", data: { action: "spend_points", path: "pts-store" } }
    ];

    return {
        type: "AdaptiveCard",
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        version: "1.3",
        body: [
            {
                type: "TextBlock",
                text: "Main Menu",
                size: "Medium",
                weight: "Bolder"
            },
            {
                type: "TextBlock",
                text: "How can I help you today?",
                wrap: true
            },
            {
              type: "ActionSet",
              actions: actions
            
            }
        ]
    };
}

function createManageCard (targetUser, groupId) {
  // Create an adaptive card with options for the target user
  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.3",
    body: [
        {
            type: "TextBlock",
            text: `What would you like to do with ${targetUser.userName}?`,
            size: "Medium",
            weight: "Bolder"
        }
    ],
    actions: [{type: "Action.Submit", title: "Promote User", data: {action: "promote_user", path: "promotion", targetUser: targetUser, groupId: groupId}},
              {type: "Action.Submit", title: "Award Points", data: {action: "award_points", path: "award-pts", targetUser: targetUser, groupId: groupId}},
              {type: "Action.Submit", title: "View Status", data: {action: "view_status", path: "look-user", targetUser: targetUser, groupId: groupId}}, 
              {type: "Action.Submit", title: "Remove User", data: {path: "purge", action: "remove_user", targetUser: targetUser, groupId: groupId}}
            ]
      };
}

function createPointsCard (groupId, targetUser){
  const card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.3",
    body: [
      {
        type: "TextBlock",
        size: "Medium",
        weight: "Bolder",
        text: "Award points"
      },
      {
        type: "TextBlock",
        text: `How many points would you like to award ${targetUser.userName}?`,
        wrap: true
      },
      {
        type: "Input.Text",
        id: "numPoints",
        placeholder: "Enter a number"
      },
      {
        type: "ActionSet",
        actions: [
          {
            type: "Action.Submit",
            title: "Enter",
            data: {
              path: "points",
              targetUser : targetUser,
              groupId : groupId
            }
          }
        ]
      }
    ]
  };
  console.log(card);
  send_card(groupId, card);
}

// Function to handle user responses
async function handleUserResponse(userId, inputText, groupId) {
  // Process the inputText as needed
  // For example, if the input is a username to promote:
  const points = (inputText); // Implement this method to find user by name
  if (targetUser) {
      userRegistry.promoteUser(targetUser); // Promote the user
      await send_message(groupId, `${targetUser.userName} has been promoted to manager.`);
  } else {
      await send_message(groupId, "User not found. Please enter a valid username.");
  }

  // Clear the waiting state
  userInputStates[userId] = false;
}