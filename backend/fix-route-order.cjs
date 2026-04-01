const fs = require('fs');
let code = fs.readFileSync('/opt/sol-ranch-dev/backend/src/routes/farm.js', 'utf8');

// Extract the shop/items route block
var shopStart = code.indexOf("router.get('/shop/items'");
var shopEnd = code.indexOf('\n\n', shopStart);
if (shopEnd === -1) shopEnd = code.indexOf('\nrouter.', shopStart + 10);
var shopBlock = code.substring(shopStart, shopEnd);

// Remove it from current position
code = code.substring(0, shopStart) + code.substring(shopEnd);

// Insert before /:wallet
var walletRoute = code.indexOf("router.get('/:wallet'");
code = code.substring(0, walletRoute) + shopBlock + '\n\n' + code.substring(walletRoute);

fs.writeFileSync('/opt/sol-ranch-dev/backend/src/routes/farm.js', code);
console.log('Done: moved /shop/items before /:wallet');
