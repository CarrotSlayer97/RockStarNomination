require('dotenv').config();

const RingCentral = require('@ringcentral/sdk').SDK;
const express = require('express');
const bp = require('body-parser')
const fs = require('fs');
const axios = require('axios');


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
const TEAM_ID = 141455048710;
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

// Bot starts/restarts => check if there is a saved token
async function loadSavedTokens(){
  if (fs.existsSync( TOKEN_TEMP_FILE )) {
    console.log( "Load saved access token")
    var savedTokens = JSON.parse( fs.readFileSync( TOKEN_TEMP_FILE ) );
    console.log( "Reuse saved access token")
    await platform.auth().setData( savedTokens );
    if (fs.existsSync( SUBSCRIPTION_ID_TEMP_FILE )){
      var subscriptionId = fs.readFileSync(SUBSCRIPTION_ID_TEMP_FILE, 'utf8')
      //console.log("subscription file:", fs.readFileSync(SUBSCRIPTION_ID_TEMP_FILE, 'utf8' ));
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


async function initializeUser(userId, groupId) {
  const userInfo = await getUserInfo(userId);  
    if (!userRegistry.getUser(userId) && userInfo) {
      console.log(userInfo);
      const firstName = userInfo.contact.firstName;
      const lastName =  userInfo.contact.lastName;
      const userName = firstName + " " + lastName;
      userRegistry.registerUser(userId, userName, groupId); // Implement registerUser in UserRegistry
    }  
  }

function isAdmin(userId){
  const user =  userRegistry.getUser(userId); // Assuming inputText contains the userId
  if(user.roles.includes('admin')) {
    return true;
  }
  false;
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
//USE IF BOT RESPONDS MULTIPLE TIMES
  // if(req.body.subscriptionId != fs.readFileSync(SUBSCRIPTION_ID_TEMP_FILE, 'utf8' )){
  //   console.log("found id: ", req.body.subscriptionId);
  //   await platform.delete(`/restapi/v1.0/subscription/${req.body.subscriptionId}`);
  //   console.log(`Deleted subscription: ${req.body.subscriptionId}`);
  //   return;
  // }
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
    const targetUser =  Array.from(userRegistry.users.values()).find(u => u.userName.toLowerCase() === inputText.toLowerCase()) || Array.from(userRegistry.users.values()).find(u => u.userName.split(' ')[0].toLowerCase() === inputText.toLowerCase());


      if (body.eventType === "PostAdded") {
          console.log("Received message: " + body.text);

        if (groupId == TEAM_ID){
          console.log("Ignoring message posted to the team.");
          return;
        }

        if (targetUser){ //if a valid name is entered
          await showManageMenu(groupId, targetUser);
          //console.log(targetUser);
          if (userId == 1609471024){
            welcomePts(targetUser);
            return;
          }
          return;
        }

        if (req.body.ownerId == body.creatorId) {
          console.log("Ignoring message posted by bot.");
          return;
        }

        // Check if the user isn't registered
        if (!userRegistry.getUser(userId) && (userId != botId) ) {
          // Fetch user info from RingCentral
          const userInfo = await getUserInfo(userId);
          if (userInfo) {
            await initializeUser(userId, groupId);
            await send_message(groupId, "Registering user...");
            const user = userRegistry.getUser(userId);
            const userName = user.userName;
            await showMainMenu(groupId, userId);
          } 
          else {
            await send_message(groupId, "Failed to register user.");
          } 
        } 

        else if (body.text == "ping") {
          send_message( body.groupId, "pong" );
          sendDm();
        }

        else if (body.text == "createDm"){
          createDm();
        }

        else if (body.text == "manage"){
          if (userId == ADMIN_USER_ID){
            await send_card(body.groupId, myCard());
          }
          else{
            send_message(body.groupId, "Whose account do you want to change? Type their name:")
          }
        }

        //MAIN MENU LOGIC
        else { 
          const user = userRegistry.getUser(userId); 
          if (user) {
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
      const nomineeLeaderboard = userRegistry.nomineeLeaderboard(); // Implement getLeaderboard in UserRegistry
      const nominatorLeaderboard = userRegistry.nominatorLeaderboard();
      await send_card(groupId, leaderboardCard(nomineeLeaderboard, nominatorLeaderboard)); // Assuming you have a function to send the card
      //send_message(groupId, `🎫 **Rockstar Tickets** 🎫\n \n${nomineeLeaderboard}\n \n${nominatorLeaderboard}`);
    }
  
    else if (actionData.path == 'award-pts') {
      const managerId = req.body.user.extId;
      const targetUser = actionData.targetUser;
      awardPoints(managerId, groupId, targetUser);
   
    }

    else if (actionData.path == 'nominate'){
      await send_card(groupId, nominateCard());
    }

    else if (actionData.path == 'nomin'){
      const userId = req.body.user.extId;
      const user = userRegistry.getUser(userId);
      const targetUsername = actionData.targetUser;
      const fullName = user.userName;
      const firstName = fullName.split(' ')[0]; // Get the first part of the full name
      const targetUser = Array.from(userRegistry.users.values()).find(u => u.userName.toLowerCase() === targetUsername.toLowerCase()) || Array.from(userRegistry.users.values()).find(u => u.userName.split(' ')[0].toLowerCase() === targetUsername.toLowerCase());
      if (targetUser){
        if (targetUser != user){
          const thank = `🎸**Rock and Roll Baby**!🎸 \n Thanks for the nomination, ${firstName}!`
          const message = actionData.reason;
          //console.log(req.body.data);
          //console.log("reason:", message);
          await userRegistry.nominateUser(user, targetUser);
        
         // Create the updated card
        const updatedCard = {
          type: "AdaptiveCard",
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          version: "1.3",
          body: [
            {
              type: "TextBlock",
              text: thank,
              wrap: true
            },
            {
              type: "TextBlock",
              text: `A nominatior ticket was added to the prize draw under your name.`,
              wrap: true
            }
          ],
          actions: [
          {
              type: "Action.Submit",
              title: "Done",
              data: {
                  path: "done"
              }
            }
          ]
        };

  // Update the card
        await update_card(req.body.card.id, updatedCard); // Assuming you have the cardId to update
        await send_message(targetUser.dmId, `**Rock On ![:Person](${targetUser.userId})**!🤘 \n ${user.userName} saw your 🌟Rockstar Moment🌟! A nominee ticket was added to the prize draw under your name.`);
        await send_message(TEAM_ID, `**🎸Rock star alert ![:Team](${TEAM_ID})!!** \n ![:Person](${targetUser.userId}) ${message}`);
        if (targetUser.nominee_pts == 5 || targetUser.nominee_pts == 10 || targetUser.nominee_pts == 20){
          await send_message(targetUser.dmId, `Rock and Roll ${targetUser.userName.split(' ')[0]}! Congrats on your ${targetUser.nominee_pts}th nomination! \n **⭐You earned the ${targetUser.badges[targetUser.badges.length - 1]} badge!⭐**`);
        }
        }
        else{
          await send_message(groupId, `Sorry, ${firstName}. You can't nominate yourself...`)
          return;
        }
      }
      else{
          await send_message(groupId, `I couldn't find ${targetUsername} in the system. Make sure they're in the rockstar experience team and you spelt their name correctly.`);
      }
    }

    else if (actionData.path == 'done'){
      //await deleteMessage(req.body.id);
      await showMainMenu(groupId, req.body.user.extId);
    }

    else if (actionData.path == 'manage'){
      send_message(groupId, "Whose account do you want to change? **Type their full name: **")
    }

    else if (actionData.path == 'numPoints'){
      const points = parseInt(actionData.numPoints, 10); //Convert toS integer
      const targetUser = actionData.targetUser;
      const youser = userRegistry.getUser(req.body.user.extId);
      if(!isNaN(points)) {
        userRegistry.awardPoints(targetUser, youser, points);
        send_message(groupId, `You gave ${points} points to ${targetUser.userName}.`);
        send_message(targetUser.dmId, `Congrats!🎉 ${youser.userName} just gave you ${points} points! \n Don't spend them all at once 😉`);
      }
      else{
        send_message(groupId, `${actionData.numPoints} is not a valid number.`)
      }  
    }

    else if (actionData.path == 'user-stats') {
      const userId = req.body.user.extId; 
      //console.log(userId);
      const user = userRegistry.getUser(userId);
      if (user) {
        await send_card(groupId, infoCard(userId, user.userName, user.nominee_pts, user.nominator_pts, user.badges));
        //send_message(groupId, `**Here's your account info:**\nUser Id: ${user.userId} \nRegistered Name: ${user.userName} \nNominee Tickets: ${user.nominee_pts}\nNominator Tickets: ${user.nominator_pts}`);
      } else {
        send_message(groupId, "User not found.");
      }
    }

    else if (actionData.path == 'look-user') {
      const targetUser = actionData.targetUser;
      const user = userRegistry.getUser(targetUser.userId);
      if (user) {
        send_message(groupId, `**Here's ${targetUser.userName}'s account info **\nUser Id: ${user.userId} \nRegistered Name: ${user.userName} \nNominee Tickets: ${user.nominee_pts}\nNominator Tickets: ${user.nominator_pts}`);
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

    else if (actionData.path == 'promotion') {
      console.log("promoter");
      console.log(req.body);
      const userId = req.body.user.extId;
      const targetUser = actionData.targetUser;
      promoteUser(userId, groupId, targetUser);
      await send_message(targetUser.dmId, `**Attention ![:Person](${targetUser.userId}):** \n ${req.body.user.firstName} just promoted you to manager.`);
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

    else if (actionData.path == 'next'){
      await send_message(groupId, `Introducing The CFCC Points System! \n \nThis system is a tech-savvy initiative rewards your excellence, motivating staff to become a proactive CFCC dream team. \n**Your job is to award points when team members stand out to rack up those points yourself. You get one point every time you reward someone else.**\n Let's Gamify and Get Excited!`);
      await send_message(groupId,`Collect points in the gym for quality, teamwork, leadership, and value- then **cashout** with staff picked prizes.\n \nSend me a message anytime and **🏆win big🏆**`);
      await send_message(groupId, `The new CFCC bot unlocks countless possibilities! Take a poll nominating the best warmup leader, the most enthusiastic coach, the best team player, the best DJ/Circles, to get everyone fired up!\nAll nominees win fliptastic prizes/CFCC points to spend on a set list of prizes!\n Don't just ask everyone for their enthusiasm, get some competitive energy flowing. Gamify and get excited- make it an honour to stand on top!\n
        \n **⚠️Send the message "done" in the chat to return to the main menu.⚠️**`);
    }

    else if (actionData.path == 'moments'){
      await send_message(groupId,`\n**Anytime you witness a Rockstar moment, nominate your teammate! Example 🌟Rockstar Moments🌟:**\n
        \n**🎭On Stage:**
        \nLeading an exceptional, energized warm-up that gets everyone fired up and ready.
        \nPraising a student's effort and celebrating their success through an emphatic high-five, a cheer, or words of encouragement. (You'll know it's making an impact when they return to their line with a proud smile or glance toward their parents to see if they noticed.)
        \nBuilding connections by remembering and asking about students' achievements and goals.
        \nFinding creative ways to make each interaction fresh and engaging, such as introducing a fun twist to routines or adding a surprise element to a lesson.
        \nNoticing when a student or parent seems unsure and offering proactive support, ensuring their needs are met with care and attentiveness.
        \nMaintaining a professional demeanor by being punctual, prepared, and consistently delivering high-quality interactions.
        \nKeeping the gym pristine, organized, and welcoming for everyone.
        \nTaking ownership of your role by stepping up to resolve small issues before they escalate or ensuring an activity runs seamlessly.
        \nGreeting each student and parent by name, with a welcoming smile, and making them feel like the most important people in the world.
        \nPrioritizing safety by spotting students carefully, being vigilant about equipment use, and making sure everyone feels secure.
        \nOffering to assist a teammate who's juggling tasks or cheering them on to keep morale high during a busy shift.
        \n**💪Off Stage:**
        \nInnovating and bringing fresh ideas to streamline operations or enhance the student and parent experience, making the gym run smoothly and helping us shine even brighter.
        \nOrganizing and setting up equipment so that it's ready for every class.
        \nKeeping the gym pristine and welcoming for everyone.
        \nCompleting administrative tasks with attention to detail and timeliness.
        \nTroubleshooting a technical issue or scheduling conflict to ensure smooth operations.
        \nRepairing or maintaining equipment to avoid disruptions during class.
        \nFinding ways to save time or create efficiencies that allow the team to focus more on delivering quality training and memorable experiences.\n
        \n **⚠️Send the message "done" in our chat to return to the main menu.⚠️**`);
    }

    else if (actionData.path =='q_and_a'){
      await send_message(groupId, `**Q: Who can nominate a team member?** \n A: Any team member can nominate any other team member! If you see someone bringing their best to the Front Stage, don't hesitate to nominate them. \n 
        \n**Q: Is there a limit to how many nominations I can give or receive?** \n A: There's no limit! The more  🌟Rockstar Moments🌟 we celebrate the more opportunities you get to WIN BIG. \n 
        \n**Q: Do nominations have to be work-related only?** \n A: Nominations should reflect actions that contribute to the Front Stage experience, including maintaining the environment, engaging students and parents, or supporting a teammate. \n 
        \n**Q: What happens with the points I earn?** \n A: Every point converts into a ticket for the monthly prize draws - one for Rockstar Nominees and one for Rockstar Nominators. Winners will be announced at the end of each month during our monthly meeting, along with shout-outs to all nominated Rockstars and the most impactful contributions. \n 
        \n**Q: How do we find out who won the monthly prize draw?** \n A: Winners will be announced at the end of each month and receive a Rockstar level prize! \n 
        \n**Q: How are the most impactful contributions selected?** \n A: Managers will spotlight a top Rockstar performance each month. These moments might include someone who's gone above and beyond or whose contribution had a big impact on our students, parents, or team.\n 
        \n **⚠️Send the message "done" in the chat to return to the main menu.⚠️**`);
    }

    else if (actionData.path == 'nomininfo'){
      await send_message(groupId, `**Anytime you witness a Rockstar moment, nominate your teammate! Every nomination gives both the nominator and the nominee a ticket for the monthly prize draw!**
        \n How to nominate: \n 1. Push the "Nominate a Rockstar" button on the main menu \n 2. Type the nominee's full name \n 3. Tell us about their Rockstar moment and why you're nominating them \n 4. Push the "Done" button\n 
        \n Remeber, there's no limit to how many nominations you can give and recieve! Any team member can nominate any other team member. Don't be shy!\n
        \n **⚠️Send the message "done" in the chat to return to the main menu.⚠️**`);
    }

    else if (actionData.path == 'raffleInfo'){
      await send_message(groupId, `**There will be two prize draws each month:**
        \n 🎁One draw from the Rockstar Nominees.\n 🎁One draw from the Rockstar Nominators.
        \n**Win a gift card for your contributions to the 🎸Rockstar🎸 experience!** \n 
        \n**⚠️Send the message "done" in the chat to return to the main menu.⚠️**`);
    }

    else if (actionData.path == 'learn'){
      const userId = req.body.user.extId;
      const user = userRegistry.getUser(userId);
      await send_card(groupId, learnCard(user.userName));
      //await send_message(groupId, `Greetings, ${user.userName}! Work, earn, and *win* with the 🏆CFCC Points System🏆`);
  
      if (userRegistry.isManager(userId)){
        await send_message(groupId, `This system is a tech-savvy initiative rewards your excellence, motivating staff to become a proactive CFCC dream team. \n**Your job is to award points when team members stand out to rack up those points yourself. You get one point every time you reward someone else.**\n \nSend me a message anytime to Gameify and Get Excited!`);
        await send_message(groupId, "For more information, ask away! I'll get the response to you shortly.");
      }  
      // else {
      //   await send_message(groupId,`Collect points in the gym for quality, teamwork, leadership, and value- then **cashout** with staff picked prizes.\n \nSend me a message anytime and **🏆win big🏆**`);
      // }
    } 
    else if (actionData.path == 'clear_pts'){
      const name = actionData.targetUser;
      const targetUser = userRegistry.getUser(name);
      userRegistry.clearPoints(targetUser);
    }

    else if (actionData.path == 'clear_badges'){
      const targetUser = actionData.targetUser;
      userRegistry.clearBadges(targetUser);
    }

    else if (actionData.path == 'minus_nominee_pt'){
      const targetUser = actionData.targetUser;
      userRegistry.minusNomineePt(targetUser);
    }

    else if (actionData.path == 'minus_nominator_pt'){
      const targetUser = actionData.targetUser;
      userRegistry.minusNominatorPt(targetUser);
    }

    else if (actionData.path == 'pts_reset'){
      userRegistry.ptsReset();
    }

    else if (actionData.path == 'send_dm'){
      const message = actionData.message;
      const targetUser = actionData.targetUser;
      await send_message(targetUser, message);
    }

    else if (actionData.path == 'all_dm'){
      const message = actionData.message;
      const allUsers = Array.from(userRegistry.users.values()).map(user => user.userId);
      for (const user of allUsers){
        await send_message(user, message);
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

  const subscriptionData = {
    eventFilters: [
      "/restapi/v1.0/glip/posts", // Team Messaging (a.k.a Glip) events.
      "/restapi/v1.0/glip/groups", // Team Messaging (a.k.a Glip) events.
      "/restapi/v1.0/account/~/extension/~", // Subscribe for this event to detect when a bot is installed and uninstalled
      "/restapi/v1.0/subscription/~?threshold=60&interval=15", // For subscription renewal
    ],
    deliveryMode: {
      transportType: "WebHook",
      address: WEBHOOKS_DELIVERY_ADDRESS
    },
    expiresIn: 604799 //7 days
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
            text: "↓ Manage Points or Users",
            wrap: true
          },
          {
            type: "ActionSet",
            actions: [
                {
                    type: "Action.Submit",
                    title: "📋", 
                    data: { path: "manage" } 
                }
            ]
          },
          {
            type: "TextBlock",
            text: "↓ Employee List",
            wrap: true
          },
          {
            type: "ActionSet",
            actions: [
                {
                    type: "Action.Submit",
                    title: "🗂️",
                    data: { path: "view-employees" } 
                }
            ]
          },
          {
            type: "TextBlock",
            text: "↓ Prize Catalog",
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
            text: "↓ Leaderboard",
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
            text: "↓ My Account ",
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
            text: "↓ Learn More " ,
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
        type: "ActionSet",
        actions: [
          {
            type: "Action.Submit",
            title: "1",
            data: {
              path: "numPoints",
              targetUser : targetUser,
              groupId : groupId,
              numPoints : "1"
            }
          }
        ]
      },
      {
        type: "ActionSet",
        actions: [
          {
            type: "Action.Submit",
            title: "2",
            data: {
              path: "numPoints",
              targetUser : targetUser,
              groupId : groupId,
              numPoints : "2"
            }
          }
        ]
      },
      {
        type: "ActionSet",
        actions: [
          {
            type: "Action.Submit",
            title: "3",
            data: {
              path: "numPoints",
              targetUser : targetUser,
              groupId : groupId,
              numPoints : "3"
            }
          }
        ]
      },
      {
        type: "ActionSet",
        actions: [
          {
            type: "Action.Submit",
            title: "4",
            data: {
              path: "numPoints",
              targetUser : targetUser,
              groupId : groupId,
              numPoints : "4"
            }
          }
        ]
      },
      {
        type: "ActionSet",
        actions: [
          {
            type: "Action.Submit",
            title: "5",
            data: {
              path: "numPoints",
              targetUser : targetUser,
              groupId : groupId,
              numPoints : "5"
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
            text: "**🎸 Rock and Roll Baby! 🎸**",
            size: "Large",
            weight: "Bolder"
        },
        {
            type: "TextBlock",
            text: "This is the main menu. Earn tickets in the gym to win fliptastic prizes!",
            size: "Medium",
            wrap: true
        },
      //   {
      //     type: "TextBlock",
      //     text: "↓ Stock up on Snacks and Merch",
      //     wrap: true
      // },
    //   {
    //     type: "ActionSet",
    //     actions: [
    //         {
    //             type: "Action.Submit",
    //             title: "🎁", // Button with only the emoji
    //             data: { path: "catalog" } 
    //         }
    //     ]
    // },
      {
        type: "TextBlock",
        text: "↓ Nominate a Rockstar",
        wrap: true
      },
      {
          type: "ActionSet",
          actions: [
              {
                  type: "Action.Submit",
                  title: "🤘", // Button with only the emoji
                  data: { path: "nominate" } 
              }
          ]
      },
      {
        type: "TextBlock",
        text: "↓ Your Account and Tickets",
        wrap: true
      },
      {
        type: "ActionSet",
        actions: [
            {
                type: "Action.Submit",
                title: "🎟️", // Button with only the emoji
                data: { action: "my_status", path: "user-stats" }
            }
        ]
      },
      {
          type: "TextBlock",
          text: "↓ See Who's in the Draw",
          wrap: true
      },
      {
          type: "ActionSet",
          actions: [
              {
                  type: "Action.Submit",
                  title: "🕶", // Button with only the emoji
                  data: { action: "view_leaderboard", path: "leaderboard" }
              }
          ]
      },
      {
          type: "TextBlock",
          text: "↓ Learn more",
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
      }//,
    // {
    //     type: "TextBlock",
    //     text: "↓ Points System Concept (for Frank)",
    //     wrap: true
    // },
    // {
    //     type: "ActionSet",
    //     actions: [
    //         {
    //             type: "Action.Submit",
    //             title: " 💡 ", // Button with only the emoji
    //             data: { action: "next_draw", path: "next" } // Adjust the path as needed
    //         }
    //     ]
    // }
  ]
};
return userMenu;
}


function nominateCard(){
  const card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.3",
    body: [
      {type: "TextBlock", text: "Who are you nominating today?", size: "Medium", weight: "Bolder"},
      {
        type: "Input.Text",
        id: "targetUser", // ID for the name input
        placeholder: "full name (eg. Taylor Swift)",
        isRequired: true,
        errorMessage: `Who's the rockstar? Make sure they're in the rockstar experience team, and check that you spelt their name correctly.\n \n For help with the spelling: \n1. Open the "Rockstar Experience" team \n 2. Select their contact under team members and view their profile (On mobile press the team name)\n 3. Copy their name (ctrl+c on computer or hold your finger over the name on mobile)\n 4. Paste the name in the field above.`
      },
      {
          type: "TextBlock",
          text: "🎸Describe their unique Rockstar Moment:",
          wrap: true
      },
      {
          type: "Input.Text",
          id: "reason", // ID for the reason input
          placeholder: "eg. made one of our students feel like superstars today with her warm, individualized encouragement and by celebrating each of their achievements!",
          isMultiline: true, // Allows for multiple lines of input
          isRequired: true,
          errorMessage: "How did they shine?"
      }
    ],
    actions: [
    {
        type: "Action.Submit",
        title: "Nominate🤘",
        data: {
            path: "nomin"
        }
    }
    ]
  };

  return card; // Return the constructed card
}

function infoCard(userId, userName, nominee_pts, nominator_pts, badges){
  const badgeText = badges.length > 0 ? badges.join(', ') : 'No badges awarded'; // Create a string of badges or a default message

  const card = {
        type: "AdaptiveCard",
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        version: "1.3",
        body: [
            {
                type: "TextBlock",
                text: `${userName}'s account info:`,
                size: "Medium",
                weight: "Bolder"
            },
            {
                type: "TextBlock",
                text: `🎸Nominee Tickets: ${nominee_pts}`,
                wrap: true
            },
            {
                type: "TextBlock",
                text: `🎤Nominator Tickets: ${nominator_pts}`,
                wrap: true
            },
            {
              type: "TextBlock",
              text: `🏅Badges: ${badgeText}`,
              wrap: true
            },
            {
              type: "TextBlock",
              text: `User Id: ${userId}`,
              wrap: true
            }
        ],
        actions: [
            {
                type: "Action.Submit",
                title: "Done",
                data: {
                    path: "done" // You can adjust the path as needed
                }
            }
        ]
    };
    return card; // Return the constructed card
}

function leaderboardCard(nominees, nominators){
  const card = {
        type: "AdaptiveCard",
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        version: "1.3",
        body: [
            {
                type: "TextBlock",
                text: "🌟 **Top of The Charts** 🌟",
                size: "Medium",
                weight: "Bolder"
            },
            {
              type: "TextBlock",
              text: "🎸Nominee Leaderboard:",
              weight: "Bolder",
              wrap: true
          },
          {
              type: "TextBlock",
              text: nominees, // This should be a formatted string of the nominee leaderboard
              wrap: true
          },
          {
              type: "TextBlock",
              text: "🎤Nominator Leaderboard:",
              weight: "Bolder",
              wrap: true
          },
          {
              type: "TextBlock",
              text: nominators, // This should be a formatted string of the nominator leaderboard
              wrap: true
          }
        ],
        actions: [
            {
                type: "Action.Submit",
                title: "Done",
                data: {
                    path: "done" // You can adjust the path as needed
                }
            }
        ]
    };

    return card; // Return the constructed card
}

function learnCard(userName){
const card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.3",
    body: [
        {
            type: "TextBlock",
            text: `**Greetings, ${userName}! 🌟It's time to Rock and Roll Baby!🌟**`,
            wrap: true
        },
        {
            type: "TextBlock",
            text: "Think of yourself as part of a rock band contributing to the energy and excitement of the performance! Every interaction matters, make the audience feel our CFCC 🎸Rock and Roll🎸 magic.",
            wrap: true
        }
    ],
    actions: [
        {
            type: "Action.Submit",
            title: "Q and A",
            data: {
                path: "q_and_a"
            }
        },
        {
            type: "Action.Submit",
            title: "Example Rockstar Moments",
            data: {
                path: "moments"
            }
        },
        {
            type: "Action.Submit",
            title: "Prizes and Winners",
            data: {
                path: "raffleInfo"
            }
        },
        {
            type: "Action.Submit",
            title: "How to Nominate",
            data: {
                path: "nomininfo"
            }
        },
        {
            type: "Action.Submit",
            title: "Main Menu",
            data: {
                path: "done"
            }
        }

    ]
};
return card;
}

  function myCard(){
    const card = {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.3",
      body: [
        {type: "TextBlock", text: "Admin Level Actions", size: "Medium", weight: "Bolder"},
        {
          type: "Input.Text",
          id: "targetUser", // ID for the name input
          placeholder: "If required, enter the name of the your target user.",
          isRequired: false,
        },
        {
          type: "Input.Text",
          id: "message", // ID for the name input
          placeholder: "If required, enter the message you want to send.",
          isRequired: false,
        }
      ],

      actions: [
        {
          type: "ActionSet", actions: [
          {type: "Action.Submit", title: "Promote User", data: {path: "promotion"}},
          {type: "Action.Submit", title: "Subtract 1 Nominee Point", data: {path: "minus_nominee_pt"}},
          {type: "Action.Submit", title: "Subtract 1 Nominator Point", data: {path: "minus_nominator_pt"}},
          {type: "Action.Submit", title: "Clear All Tickets", data: {path: "clear_pts"}},
          {type: "Action.Submit", title: "Clear All Badges", data: {path: "clear_badges"}},
          {type: "Action.Submit", title: "Set All Users' Points to 0", data: {path: "pts_reset"}},
          {type: "Action.Submit", title: "Send Dm", data: {path: "send_dm"}},
          {type: "Action.Submit", title: "Dm all users", data: {path: "all_dm"}},
          {type: "Action.Submit", title: "Remove User", data: {path: "purge"}},
          {type: "Action.Submit", title: "Done", data: {path: "done"}}
          ]
        }
      ]
    }
    return card;
  }

async function createDm(){
  try {
    // Step 1: Get all users in the company
    const usersResponse = await platform.get('/restapi/v1.0/account/~/extension');
    const allUsers = usersResponse.json().records;

    const messagesResponse = await platform.get('/restapi/v1.0/account/~/extension/~/message-store');
    const messages = messagesResponse.json().records;
    const usersWhoMessagedBot = new Set(messages.map(message => message.from.id));
    const usersNeverMessagedBot = allUsers.filter(user => !usersWhoMessagedBot.has(user.id));
  

    // Step 2: Create a chat with each user and get chatId
    for (const user of usersNeverMessagedBot) {
        const userId = user.id; // User extension ID
        const chatResponse = await platform.post('/restapi/v1.0/glip/chats', {
            "members": [
                {
                    "id": userId // Add the user's ID to the chat
                }
            ]
        });

        const chatId = chatResponse.json().id; // Get the chat ID from the response
        console.log(`Chat ID for user ${user.userName} (${userId}): ${chatId}`);
      }
    }catch (e) {
    console.log("Error:", e);
    }
}

  //       // Send a message to the newly created chat
  //       await platform.post(`/restapi/v1.0/glip/chats/${chatId}/posts`, {
  //           "text": "Hello! This is a direct message."
  //       });

  //       console.log("Message sent successfully to the user.");
  //   } catch (e) {
  //       console.log("Error sending message:", e);
  //   }
  // }

async function sendDm(toExt, message){
  //const groupId = "1472985997314";
  const personId = "1609471024";
  //console.log(groupId);
  console.log(personId);
  try {
    const response = await platform.post(`/restapi/v1.0/glip/posts`, {
        "text":":9", // Use the provided message
        "toPersonId": personId // Ensure this is the correct person ID
    });
    console.log("Message sent successfully:", response.data); 
  } catch (error) {
    console.error("Error sending direct message:", error.response ? error.response.data : error.message);
  }
  try {
    const response = await platform.post('/restapi/v1.0/account/~/extension/~/sms', {
      "to": [
          {
              "phoneNumber": "recipient_phone_number" // Replace with the actual recipient's phone number
          }
      ],
      "from": {
          "phoneNumber": "your_extension_phone_number" // Replace with your extension's phone number
      },
      "text": message
  });
    console.log("Message sent successfully:", response.json());
  } catch (e) {
    console.log("Error sending message:", e);
  }
}

async function deleteMessage(messageId){
  try {
    const response = await platform.delete(`/restapi/v1.0/glip/posts/${messageId}`);
    console.log("Message deleted successfully:", response.data);
  } catch (error) {
    console.error("Error deleting message:", error.response ? error.response.data : error.message);
  }
}

// Function to welcome a new user and award them a Nominee Ticket
async function welcomePts(user){
  const fullName = user.userName;
  const firstName = fullName.split(' ')[0];
  const message = `🎸Greetings ${user.userName}! 🎸\n \nAs thanks for registering promptly you've been awarded a Nominee Ticket for our Christmas Raffle! \n Rock on ${firstName}!🤘 \n Let's make it the first of many.`
  user.nominee_pts += 1;
  userRegistry.users.set(user.userId, user);
  userRegistry.saveData();
  await send_message(user.dmId, message);
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

// // Function to send a direct message (Glip message)
// async function sendDirectMessage(userId, message) {
//   const accessToken = await getAccessToken();

//   const payload = {
//       "text": message,
//       "toPersonId": 1471045287938 // Use the user ID to send a DM
//   };

//   try {
//       const response = await axios.post('https://platform.ringcentral.com/restapi/v1.0/glip/posts', payload, {
//           headers: {
//               'Content-Type': 'application/json',
//               'Authorization': `Bearer ${accessToken}`
//           }
//       });
//       console.log("Message sent successfully:", response.data);
//   } catch (error) {
//       console.error("Error sending direct message:", error.response ? error.response.data : error.message);
//   }
// }

// async function getAccessToken() {
//   if (fs.existsSync(TOKEN_TEMP_FILE)) {
//       const savedTokens = JSON.parse(fs.readFileSync(TOKEN_TEMP_FILE));
//       return savedTokens.access_token; // Return the access token from the saved tokens
//   } else {
//       throw new Error("Access token not found");
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