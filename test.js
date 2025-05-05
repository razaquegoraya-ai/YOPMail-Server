require('dotenv').config();
const axios = require('axios');

// Configuration
const config = {
  serverUrl: `http://localhost:${process.env.YOPMAIL_SERVER_PORT || 7091}`,
  testAliases: [
    'NYXEL.XANDOR.e0d7', 'NYXEL.XANDOR.zvr9', 'NYXEL.XANDOR.rf27', 'NYXEL.XANDOR.kqr2',
    'NYXEL.XANDOR.auo1', 'NYXEL.XANDOR.pzs1', 'NYXEL.XANDOR.c8s8', 'NYXEL.XANDOR.oda3',
    'NYXEL.XANDOR.d248', 'NYXEL.XANDOR.s891', 'NYXEL.XANDOR.yfz1', 'NYXEL.XANDOR.6mm9',
    'NYXEL.XANDOR.5br7', 'NYXEL.XANDOR.v575', 'NYXEL.XANDOR.1ii7', 'NYXEL.XANDOR.5rh9',
    'NYXEL.XANDOR.n7n5', 'NYXEL.XANDOR.zk37', 'NYXEL.XANDOR.yal8', 'NYXEL.XANDOR.t141',
    'NYXEL.XANDOR.v4p3', 'NYXEL.XANDOR.mf34', 'NYXEL.XANDOR.z0h1', 'NYXEL.XANDOR.mjb9',
    'NYXEL.XANDOR.wij6', 'NYXEL.XANDOR.lxc5', 'NYXEL.XANDOR.qn87', 'NYXEL.XANDOR.mpu8',
    'NYXEL.XANDOR.7yf1', 'NYXEL.XANDOR.qbt0', 'NYXEL.XANDOR.8p19', 'NYXEL.XANDOR.zgm9',
    'NYXEL.XANDOR.w350', 'NYXEL.XANDOR.k958', 'NYXEL.XANDOR.e8n0', 'NYXEL.XANDOR.yj50',
    'NYXEL.XANDOR.ze48', 'NYXEL.XANDOR.42u5', 'NYXEL.XANDOR.n852', 'NYXEL.XANDOR.2k67'
  ],
  testSubject: 'BLS Visa Appointment - User Verification'
};

// Function to make a single request
async function makeRequest(alias, index) {
  try {
    console.log(`Making request ${index + 1}/${config.testAliases.length} for alias: ${alias}`);
    
    const response = await axios.post(`${config.serverUrl}/get-code`, {
      alias: alias,
      subject: config.testSubject
    });
    
    console.log(`Request ${index + 1} completed for ${alias}:`, response.data);
    return { alias, data: response.data, success: true };
  } catch (error) {
    console.error(`Request ${index + 1} failed for ${alias}:`, error.message);
    return { alias, error: error.message, success: false };
  }
}

// Function to run all requests
async function runTest() {
  console.log('Starting test...');
  console.log(`Server URL: ${config.serverUrl}`);
  console.log(`Number of aliases: ${config.testAliases.length}`);
  console.log(`Test subject: ${config.testSubject}`);
  console.log('-----------------------------------');

  const startTime = Date.now();
  
  // Create array of promises for concurrent requests
  const requests = config.testAliases.map((alias, index) => makeRequest(alias, index));
  
  // Wait for all requests to complete
  const results = await Promise.all(requests);
  
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000; // Convert to seconds
  
  // Calculate statistics
  const successfulRequests = results.filter(r => r.success).length;
  const failedRequests = config.testAliases.length - successfulRequests;
  
  console.log('-----------------------------------');
  console.log('Test completed!');
  console.log(`Total duration: ${duration.toFixed(2)} seconds`);
  console.log(`Successful requests: ${successfulRequests}`);
  console.log(`Failed requests: ${failedRequests}`);
  console.log(`Success rate: ${((successfulRequests / config.testAliases.length) * 100).toFixed(2)}%`);
  
  // Log failed requests
  const failedAliases = results.filter(r => !r.success).map(r => r.alias);
  if (failedAliases.length > 0) {
    console.log('\nFailed aliases:');
    failedAliases.forEach(alias => console.log(`- ${alias}`));
  }
}

// Run the test
runTest().catch(console.error);