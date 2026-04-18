const MarginUtils = require('../utils/MarginUtils');

const mockTrades = [
    { symbol: 'MCX:SILVERMIC26JUNFUT', market_type: 'MCX', qty: 2, entry_price: 70000 },
    { symbol: 'MCX:CRUDEOILMINI26JUNFUT', market_type: 'MCX', qty: 10, entry_price: 6500 },
    { symbol: 'EQUITY:RELIANCE', market_type: 'EQUITY', qty: 100, entry_price: 2500 }
];

const mockConfig = {
    mcxLotMargins: {
        'SILVER MIC': { HOLDING: '2000', LOT: '1' },
        'CRUDEOIL MINI': { HOLDING: '500', LOT: '1' },
        'GOLD': { HOLDING: '5000', LOT: '1' }
    },
    equityHoldingMargin: '10' // 10x
};

function test() {
    console.log('--- Testing Margin Calculation ---');
    
    // Test Scrip Matching
    const s1 = MarginUtils.getMcxBaseScrip('MCX:SILVERMIC26JUNFUT', mockConfig.mcxLotMargins);
    console.log(`Symbol: SILVERMIC26JUNFUT -> Match: ${s1} (Expected: SILVER MIC)`);
    
    const s2 = MarginUtils.getMcxBaseScrip('MCX:CRUDEOILMINI26JUNFUT', mockConfig.mcxLotMargins);
    console.log(`Symbol: CRUDEOILMINI26JUNFUT -> Match: ${s2} (Expected: CRUDEOIL MINI)`);

    const s3 = MarginUtils.getMcxBaseScrip('MCX:GOLD26JUNFUT', mockConfig.mcxLotMargins);
    console.log(`Symbol: GOLD26JUNFUT -> Match: ${s3} (Expected: GOLD)`);

    // Test Total Margin
    const total = MarginUtils.calculateTotalRequiredHoldingMargin(mockTrades, mockConfig);
    console.log(`\nTotal Blocked Margin: ₹${total.toFixed(2)}`);
    // Expected: 
    // Silver Mic: 2000 * (2/1) = 4000
    // Crudeoil Mini: 500 * (10/1) = 5000
    // Equity Reliance: (2500 * 100) / 10 = 25000
    // Total: 4000 + 5000 + 25000 = 34000
}

test();
