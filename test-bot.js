const axios = require('axios');

const BOT_TOKEN = '8406203708:AAHCc-EXNjt6QQSn0ION2Te7xJAzbqa3G60';

async function testBot() {
  try {
    // Test 1: Check bot info
    console.log('Test 1: Getting bot info...');
    const botInfo = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    console.log('✅ Bot Info:', {
      username: botInfo.data.result.username,
      name: botInfo.data.result.first_name,
      id: botInfo.data.result.id
    });
    
    // Test 2: Check if bot is receiving updates
    console.log('\nTest 2: Checking recent updates...');
    const updates = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=1`);
    console.log('✅ Bot is receiving updates:', updates.data.ok);
    
    if (updates.data.result.length > 0) {
      console.log('Last update:', {
        from: updates.data.result[0].message?.from?.username,
        text: updates.data.result[0].message?.text,
        date: new Date(updates.data.result[0].message?.date * 1000).toLocaleString()
      });
    }
    
    console.log('\n✅ Bot is working! Open Telegram and send /start to:');
    console.log(`   @${botInfo.data.result.username}`);
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

testBot();
