import puppeteer from 'puppeteer';

(async () => {
  console.log('🧪 BDA Smoke Test Starting...\n');
  
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  // Capture console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  
  page.on('pageerror', err => {
    errors.push(`Page Error: ${err.message}`);
  });
  
  try {
    // Navigate to app
    console.log('📍 Navigating to http://localhost:5174/');
    await page.goto('http://localhost:5174/', { waitUntil: 'networkidle0', timeout: 30000 });
    console.log('✅ Page loaded\n');
    
    // Wait for main menu
    console.log('🔍 Looking for main menu...');
    const mainMenu = await page.$('button[data-testid="main-menu"], button:contains("Base Defense Architect"), a:contains("Base Defense Architect")');
    if (mainMenu) {
      console.log('✅ Main menu found\n');
    } else {
      console.log('⚠️  Main menu not found (may need manual navigation)\n');
    }
    
    // Try to find BDA button/link
    console.log('🔍 Looking for Base Defense Architect entry point...');
    const bdaLink = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, button'));
      const bda = links.find(el => el.textContent.includes('Base Defense') || el.textContent.includes('BDA'));
      return bda ? bda.textContent.trim() : null;
    });
    
    if (bdaLink) {
      console.log(`✅ BDA entry point found: "${bdaLink}"\n`);
    } else {
      console.log('⚠️  BDA entry point not found\n');
    }
    
    // Check for any console errors
    if (errors.length > 0) {
      console.log('❌ Console Errors Detected:\n');
      errors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
    } else {
      console.log('✅ No console errors\n');
    }
    
    // Take a screenshot
    await page.screenshot({ path: '/tmp/bda-smoke-test.png', fullPage: true });
    console.log('📸 Screenshot saved to /tmp/bda-smoke-test.png\n');
    
    console.log('═══════════════════════════════════════');
    console.log('SMOKE TEST COMPLETE');
    console.log('═══════════════════════════════════════');
    
  } catch (err) {
    console.error('❌ Test Failed:', err.message);
  } finally {
    await browser.close();
  }
})();
