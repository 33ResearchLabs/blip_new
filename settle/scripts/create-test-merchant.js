/**
 * Create Test Merchant Account
 *
 * This script creates a test merchant account for testing the Apple-inspired UI
 */

async function createTestMerchant() {
  const apiUrl = 'http://localhost:3000/api/auth/merchant';

  const testMerchant = {
    action: 'register',
    email: 'test@blip.money',
    password: 'test123',
    business_name: 'Test Merchant Shop',
  };

  console.log('🔵 Creating test merchant account...');
  console.log('📧 Email:', testMerchant.email);
  console.log('🔑 Password:', testMerchant.password);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testMerchant),
    });

    const data = await response.json();

    if (data.success) {
      console.log('\n✅ Test merchant created successfully!');
      console.log('\n📋 Login Credentials:');
      console.log('   Email: test@blip.money');
      console.log('   Password: test123');
      console.log('\n🌐 Merchant Dashboard: http://localhost:3000/merchant');
      console.log('\n👤 Merchant Info:');
      console.log('   ID:', data.data.merchant.id);
      console.log('   Username:', data.data.merchant.username);
      console.log('   Business Name:', data.data.merchant.business_name);
      console.log('   Display Name:', data.data.merchant.display_name);

      if (data.data.needsUsername) {
        console.log('\n⚠️  Note: You will need to set a username on first login');
      }
    } else {
      if (response.status === 409) {
        console.log('\n⚠️  Merchant already exists! Use these credentials to login:');
        console.log('   Email: test@blip.money');
        console.log('   Password: test123');
        console.log('\n🌐 Merchant Dashboard: http://localhost:3000/merchant');
      } else {
        console.log('\n❌ Failed to create merchant:', data.error);
      }
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.log('\n💡 Make sure the dev server is running on http://localhost:3000');
  }
}

// Run the script
createTestMerchant();
