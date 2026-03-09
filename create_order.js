const axios = require('axios');

async function createOrder() {
  try {
    const response = await axios.post('http://localhost:3000/api/merchant/orders', {
      merchant_id: '2b0c09f2-0360-4fb8-8f81-350f4c1e256e',
      type: 'sell',
      crypto_amount: 100,
      payment_method: 'bank',
      spread_preference: 'fastest'
    });
    
    console.log('✅ Order created:', {
      order_number: response.data.data.order_number,
      status: response.data.data.status,
      type: response.data.data.type,
      amount: response.data.data.crypto_amount
    });
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

createOrder();
