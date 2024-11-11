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

function getUserPoints(userId) {
  return userPoints[userId] || 0; // Return points or 0 if not found
}

//give manager role
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

function awardPoints(userId, groupId, targetUser) {
  if (userRegistry.isManager(userId)) {
    createPointsCard(groupId, targetUser);
  } else {
      send_message(groupId, "You don't have permission to award points.");
  }
}

function removeUser(userId, groupId, targetUser){
  if (isAdmin(userId)) {
    //userRegistry.removeUser(targetUser);
    send_message(groupId, "This function isn't set up yet.")//`${targetUser.userName} has been removed from the system.`)
  }
}

// Call the main function to start the bot
if (require.main === module) {
  main();
}

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

// Handles webhook notifications-- invoked by users
app.post('/webhook-callback', async function (req, res) {
  var validationToken = req.get('Validation-Token');
  if (validationToken) {
    console.log('Verifying webhook token.');
    res.setHeader('Validation-Token', validationToken);
  } else if (req.body.event == "/restapi/v1.0/subscription/~?threshold=60&interval=15") {
    console.log("Renewing subscription ID: " + req.body.subscriptionId);
    renewSubscription(req.body.subscriptionId);
  }  

  console.log("Receieved request", req.body);

  if (req.body.body && req.body.body.text) {
    const body = req.body.body;
    const userId = body.creatorId;
    const botId = req.body.ownerId;
    const groupId = body.groupId;
    const inputText =  body.text.trim();
    const targetUser =  Array.from(userRegistry.users.values()).find(u => u.userName.toLowerCase() === inputText.toLowerCase());

      if (req.body.body.eventType === "PostAdded") {
          console.log("Received message: " + body.text);

           
        if (targetUser){ //if a valid name is entered
          await showManageMenu(groupId, targetUser);
          console.log(targetUser);
        }

        if (req.body.ownerId == body.creatorId) {
          console.log("Ignoring message posted by bot.");
          return;
        }

        // Check if the user isn't registered
        if (!userRegistry.getUser(userId) && (userId != botId)) {
          // Fetch user info from RingCentral
          const userInfo = await getUserInfo(userId);
          if (userInfo) {
            await initializeUser(userId);
            await send_message(body.groupId, "Registering user...");
            const user = userRegistry.getUser(userId);
            const userName = user.userName;
            await send_message(groupId, `Greetings, ${userName} and welcome to the CFCC points system!`)
            await showMainMenu(groupId, userId);
          } 
          else {
            await send_message(req.body.groupId, "Failed to register user.");
          } 
        } 

        else if (body.text == "ping") {
          send_message( body.groupId, "pong" );
        }

        else if (body.text == "manage"){
          send_message(body.groupId, "Whose account do you want to change? Type their first name:")
        }

        //MAIN MENU LOGIC
        else { 
          const user = userRegistry.getUser(userId); 
          if (user) {
            //await send_message(groupId, `Greetings, ${userName}!`); Welcome to the CFCC Points System. \nThe system is a tech-savvy initiative that rewards you for your exceptional performance.`);
            await showMainMenu(groupId, userId); 
          } 
        }

    // else if (body.text.startsWith("give_points")) {
    //   //Give points
    //   const [_, targetUserId, points] = body.text.split(" ");
    //   if (userRegistry.isManager(userId)) {
    //     userRegistry.awardPoints(targetUserId, parseInt(points)); // Implement awardPoints in UserRegistry
    //     await send_message(body.groupId, `Awarded ${points} points to user ${targetUserId}.`);
    //   } 
    //   else {
    //     await send_message(body.groupId, "You don't have permission to give points.");
    //   } 
    // }
    
    // else {
    //   var message = `I don't understand ${body.text}`
    //   send_message( body.groupId, message )
    // } 
  
  //END OF TEXT COMMANDS

      }     
  }     
  else if (req.body.conversation) {
    const actionData = req.body.data;
    const groupId = req.body.conversation.id;
    if (!actionData || !groupId) {
      await send_message("Something went wrong.")
      return;
    }

    if (actionData.path == 'leaderboard') {
      const leaderboard = userRegistry.getLeaderboard(); // Implement getLeaderboard in UserRegistry
      send_message(groupId, `🏆 **Leaderboard** 🏆\n \n${leaderboard}`);
    }
  
    else if (actionData.path == 'award-pts') {
      const managerId = req.body.user.extId;
      const targetUser = req.body.data.targetUser;
      awardPoints(managerId, groupId, targetUser);
   
    }

    else if (actionData.path == 'manage'){
      send_message(groupId, "Whose account do you want to change? **Type their first name: **")
    }

    else if (actionData.path == 'numPoints'){
      const points = parseInt(req.body.data.numPoints, 10); //Convert toS integer
      const targetUser = req.body.data.targetUser;
      if(!isNaN(points)) {
        userRegistry.awardPoints(targetUser, points);
        send_message(groupId, `You gave ${points} points to ${targetUser.userName}.`);
      }
      else{
        send_message(groupId, `${req.body.data.numPoints} is not a valid number.`)
      }  
    }

    else if (actionData.path == 'user-stats') {
      const userId = req.body.user.extId; 
      console.log(userId);
      const user = userRegistry.getUser(userId);
      if (user) {
        send_message(groupId, `**Here's your account info:**\n \nUser Id: ${user.userId} \nRegistered Name: ${user.userName} \nCurrent Points: ${user.points}\nRole: ${user.roles}`);
      } else {
        send_message(groupId, "User not found.");
      }
    }

    else if (actionData.path == 'look-user') {
      const targetUser = req.body.data.targetUser;
      const user = userRegistry.getUser(targetUser.userId);
      if (user) {
        send_message(groupId, `**Here's ${targetUser.userName}'s account info **\n \nUser Id: ${user.userId} \nRegistered Name: ${user.userName} \nCurrent Points: ${user.points}`);
      } 
    }

    else if (actionData.path == 'catalog') {
      const userId = req.body.user.extId;
      const card = createCatalogCard(userId, groupId);
      await send_card(groupId, card);
    }

    else if (actionData.path == 'view-employees') {
      const employees = Array.from(userRegistry.users.values()).map(user => `${user.userName} (ID: ${user.userId})`).join('\n');
      send_message(groupId, `Registered Employees:\n${employees}`);
    }

    else if (actionData.path == 'purge'){
      const targetUser = req.body.data.targetUser;
      const adminId = req.body.user.extId;
      removeUser(adminId, groupId, targetUser);
    }

    else if (actionData.path == 'help') {
      const userId = req.body.user.extId;
      const card = helpCard(userId, groupId)
      await send_card(groupId, card);
    } 

    else if (actionData.path == 'promotion') {
      console.log("promoter");
      console.log(req.body);
      const userId = req.body.user.extId;
      const targetUser = req.body.data.targetUser;
      promoteUser(userId, groupId, targetUser);
    }

    else if (actionData.path == 'buy') {
      const userId = actionData.userId; 
      const user = userRegistry.getUser(userId);
      const prize = actionData.itemName;
      const cost = actionData.itemCost
      if (user.points >= cost) {
        userRegistry.buyPrize(user, prize, cost);
        send_message(groupId, `**🎉 Congratulations ${user.userName}🎉** \nShow this message to redeemed your hard earned ${prize}!`);
      } 
      else {
        send_message(groupId, `You don't have enough points to buy ${prize}.`);
      }
    }
  }
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

async function showMainMenu(groupId, userId) {
  if (userRegistry.isManager(userId)){
    const card = managerMenu(); // Create the menu card
    await send_card(groupId, card); // Send the card to the group
  }
  else {
    const card = userMenu();
    await send_card(groupId, card); 
  }
}

async function showManageMenu (groupId, targetUser){
  const card = createManageCard(targetUser, groupId);
  await send_card(groupId, card);
}

function managerMenu() {
    const card = {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.3",
      body: [
          {
              type: "TextBlock",
              text: "It's Time to Win Big!",
              size: "Large",
              weight: "Bolder"
          },
          {
              type: "TextBlock",
              text: "Earn points in the gym to get fliptastic prizes!",
              size: "Medium",
              wrap: true
          },
          {
            type: "TextBlock",
            text: "Manage Points or Users",
            wrap: true
          },
          {
            type: "ActionSet",
            actions: [
                {
                    type: "Action.Submit",
                    title: "📋", 
                    data: { path: "catalog" } 
                }
            ]
          },
          {
            type: "TextBlock",
            text: "Employee List",
            wrap: true
          },
          {
            type: "ActionSet",
            actions: [
                {
                    type: "Action.Submit",
                    title: "🗂️",
                    data: { path: "catalog" } 
                }
            ]
          },
          {
            type: "TextBlock",
            text: "Prize Catalog",
            wrap: true
        },
        {
            type: "ActionSet",
            actions: [
                {
                    type: "Action.Submit",
                    title: "🎁", // Button with only the emoji
                    data: { path: "catalog" } 
                }
            ]
        },
        {
            type: "TextBlock",
            text: "Leaderboard",
            wrap: true
        },
        {
            type: "ActionSet",
            actions: [
                {
                    type: "Action.Submit",
                    title: "🏆", // Button with only the emoji
                    data: { action: "view_leaderboard", path: "leaderboard" }
                }
            ]
        },
        {
            type: "TextBlock",
            text: "My Account",
            wrap: true
        },
        {
            type: "ActionSet",
            actions: [
                {
                    type: "Action.Submit",
                    title: "🤸", // Button with only the emoji
                    data: { action: "my_status", path: "user-stats" }
                }
            ]
        },
        {
            type: "TextBlock",
            text: "Learn more",
            wrap: true
        },
        {
            type: "ActionSet",
            actions: [
                {
                    type: "Action.Submit",
                    title: "📚", // Button with only the emoji
                    data: { action: "learn_more", path: "learn" } // Adjust the path as needed
                }
            ]
        }
    ]
  };
  return card;
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
              {type: "Action.Submit", title: "View Their Status", data: {action: "view_status", path: "look-user", targetUser: targetUser, groupId: groupId}}, 
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
        placeholder: "Enter a number (eg. 3)"
      },
      {
        type: "ActionSet",
        actions: [
          {
            type: "Action.Submit",
            title: "Enter",
            data: {
              path: "numPoints",
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

function createCatalogCard(userId, groupId) {
  const user = userRegistry.getUser(userId);
  const currentPoints = user ? user.points : 0; // Get current points or default to 0

  const catalogItems = userRegistry.getCatalog(); // Get catalog items from UserRegistry

  // Create the body of the adaptive card
  const body = [
      {
          type: "TextBlock",
          text: " 🎁 Prizes 🎁",
          size: "Medium",
          weight: "Bolder"
      },
      {
          type: "ColumnSet",
          columns: [
            {
              type: "Column",
              width: "stretch", // auto for horizontal layout //stretch to fill available space
              items: catalogItems.map((item, index) => [
                  {
                      type: "TextBlock",
                      text: `${item.name}`,
                      wrap: true
                  },
                  {
                      type: "ActionSet",
                      actions: [
                          {
                              type: "Action.Submit",
                              title: `Buy for ${item.cost} points`,
                              data: {
                                  path: "buy",
                                  itemName: item.name,
                                  itemCost: item.cost,
                                  userId: userId,
                                  groupId: groupId
                              }
                          }
                      ]
                  },
                  {
                    type: "TextBlock",
                    text: "", //empty textblock for spacing
                    wrap: true
                  }
              ]).flat() //Flatten the array of items
            }
          ]
      },
      {
          type: "TextBlock",
          text: `You have ${currentPoints} points.`,
          size: "Medium",
          weight: "Bolder"
      }
  ];

  // Return the complete adaptive card
  return {
      type: "AdaptiveCard",
     $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
     version: "1.3",
     body: body,
     actions: [] // You can add global actions if needed
  };
}

function userMenu(){
  const userMenu = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.3",
    body: [
        {
            type: "TextBlock",
            text: "It's Time to Win Big!",
            size: "Large",
            weight: "Bolder"
        },
        {
            type: "TextBlock",
            text: "Earn points in the gym to get fliptastic prizes!",
            size: "Medium",
            wrap: true
        },
        {
          type: "TextBlock",
          text: "Stock up on snacks and merch",
          wrap: true
      },
      {
          type: "ActionSet",
          actions: [
              {
                  type: "Action.Submit",
                  title: "🎁", // Button with only the emoji
                  data: { path: "catalog" } 
              }
          ]
      },
      {
          type: "TextBlock",
          text: "See who's on top",
          wrap: true
      },
      {
          type: "ActionSet",
          actions: [
              {
                  type: "Action.Submit",
                  title: "🏆", // Button with only the emoji
                  data: { action: "view_leaderboard", path: "leaderboard" }
              }
          ]
      },
      {
          type: "TextBlock",
          text: "Check where you're at",
          wrap: true
      },
      {
          type: "ActionSet",
          actions: [
              {
                  type: "Action.Submit",
                  title: "🤸", // Button with only the emoji
                  data: { action: "my_status", path: "user-stats" }
              }
          ]
      },
      {
          type: "TextBlock",
          text: "Learn more",
          wrap: true
      },
      {
          type: "ActionSet",
          actions: [
              {
                  type: "Action.Submit",
                  title: "📚", // Button with only the emoji
                  data: { action: "learn_more", path: "learn" } // Adjust the path as needed
              }
          ]
      }
  ]
};
return userMenu;
}
// // Update an adaptive card
// async function update_card( cardId, card ) {
//   console.log("Updating card...");
//   try {
//     var resp = await platform.put(`/restapi/v1.0/glip/adaptive-cards/${cardId}`, card)
//   }catch (e) {
//     console.log(e.message)
//   }
// }

// function make_hello_world_card(name) {
//   var card = {
//     type: "AdaptiveCard",
//     $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
//     version: "1.3",
//     body: [
//       {
//         type: "TextBlock",
//         size: "Medium",
//         weight: "Bolder",
//         text: "Hello World"
//       },
//       {
//         type: "TextBlock",
//         text: "Enter your name in the field below so that I can say hello.",
//         wrap: true
//       },
//       {
//         type: "Input.Text",
//         id: "hellotext",
//         placeholder: "Enter your name"
//       },
//       {
//         type: "ActionSet",
//         actions: [
//           {
//             type: "Action.Submit",
//             title: "Send a new card",
//             data: {
//               path: "new-card"
//             }
//           },
//           {
//             type: "Action.Submit",
//             title: "Update this card",
//             data: {
//               path: "update-card"
//             }
//           }
//         ]
//       }
//     ]
//   }
//   if (name){
//     card.body.push({
//       type: "Container",
//       separator: true,
//       items: [
//         {
//           type: "TextBlock",
//           text: `Hello ${name}`,
//           wrap: true
//         }
//       ]
//     })
//   }
//   return card
// // }

// function make_new_name_card(name) {
//   return {
//     "type": "AdaptiveCard",
//     "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
//     "version": "1.3",
//     "body": [
//       {
//         "type": "TextBlock",
//         "size": "Medium",
//         "weight": "Bolder",
//         "text": "Hello World"
//       },
//       {
//         "type": "TextBlock",
//         "text": `Hello ${name}`,
//         "wrap": true
//       }
//     ]
//     }
//   }