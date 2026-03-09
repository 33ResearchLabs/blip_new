const axios = require('axios');

// These orders are stuck in "escrowed" status but have no buyer - they should be cancelled
const stuckOrders = [
  '0152bd1f-a66a-402d-853a-2d78e8323d41',
  'e8fc6673-1e7d-4088-9e49-d7b91fbbf74d', 
  '0ad4ed3f-e7ad-4b20-afcb-0f914e2bb1cd',
  'c888dd3f-7cba-415d-b7c2-b7abcd8c52f4'
];

async function fixOrders() {
  console.log('Cancelling stuck orders that are escrowed without buyers...\n');
  
  for (const orderId of stuckOrders) {
    try {
      await axios.delete(
        `http://localhost:3000/api/orders/${orderId}?actor_type=admin&actor_id=admin&reason=Cleanup: escrowed without buyer`
      );
      console.log(`✅ Cancelled order ${orderId.slice(0, 8)}`);
    } catch (error) {
      console.log(`⚠️  Failed to cancel ${orderId.slice(0, 8)}: ${error.response?.data?.error || error.message}`);
    }
  }
  
  console.log('\n✅ Cleanup complete! Now only valid pending orders remain.');
}

fixOrders();
