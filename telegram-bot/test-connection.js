require('dotenv').config();
const axios = require('axios');

const token = process.env.BOT_TOKEN;
console.log('Token exists:', token ? 'YES' : 'NO');
console.log('Token preview:', token ? token.substring(0, 10) + '...' : 'MISSING');

axios.get('https://api.telegram.org/bot' + token + '/getMe')
  .then(r => {
    console.log('Bot connected:', JSON.stringify(r.data.result, null, 2));
  })
  .catch(e => {
    console.log('Error:', e.response ? e.response.data : e.message);
  });
