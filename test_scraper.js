const { scraper, priceEmitter } = require('./dist/scraper');

async function testScraper() {

  priceEmitter.on('price', (data) => {
    console.log('Price received:', data);
  });

  priceEmitter.on('error', (error) => {
    console.error('Error:', error.message);
  });

  // Test for 5 seconds
  setTimeout(() => {
    scraper.stop();
    console.log('Test completed');
    process.exit(0);
  }, 5000);

  await scraper.start();
}

testScraper().catch(console.error);
