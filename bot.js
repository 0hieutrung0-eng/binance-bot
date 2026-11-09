const axios = require('axios');
const crypto = require('crypto');

const apiKey = process.env.BINANCE_API_KEY;
const apiSecret = process.env.BINANCE_API_SECRET;
const baseURL = 'https://fapi.binance.com';

function signQuery(queryString) {
    return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

async function runBot() {
    try {
        const timestamp = Date.now();

        // 1. KIỂM TRA VỊ THẾ ĐANG MỞ
        const posQuery = `timestamp=${timestamp}`;
        const posSig = signQuery(posQuery);
        const posRes = await axios.get(`${baseURL}/fapi/v2/positionRisk?${posQuery}&signature=${posSig}`, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });

        const activePositions = posRes.data.filter(p => parseFloat(p.positionAmt) !== 0);
        if (activePositions.length > 0) {
            console.log("Đang có lệnh treo trên sàn, bỏ qua chu kỳ này.");
            return;
        }

        // 2. LẤY SỐ DƯ TÀI KHOẢN (KIỂM TRA SỐ DƯ CUỐI CÙNG)
        const accQuery = `timestamp=${timestamp}`;
        const accSig = signQuery(accQuery);
        const accRes = await axios.get(`${baseURL}/fapi/v2/account?${accQuery}&signature=${accSig}`, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });
        const availableBalance = parseFloat(accRes.data.availableBalance);
        console.log(`Số dư khả dụng hiện tại: ${availableBalance} USDT`);

        // 3. LẤY DỮ LIỆU 24H TICKER TỪ BINANCE
        const tickerRes = await axios.get(`${baseURL}/fapi/v1/ticker/24hr`);
        let tickers = tickerRes.data.filter(t => t.symbol.endsWith('USDT'));

        // Sắp xếp theo biến động giá 24h
        tickers.sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));

        const top5Gainers = tickers.slice(0, 5);

        // 4. CHỌN COIN & HƯỚNG ĐÁNH (Long top tăng mạnh)
        let chosenCoin = top5Gainers[0]; 
        let symbol = chosenCoin.symbol;
        let currentPrice = parseFloat(chosenCoin.lastPrice);
        let side = "BUY"; // "BUY" cho Long

        // Phân bổ vốn: Long 95%, Short 50%
        let allocationRatio = (side === "BUY") ? 0.95 : 0.50;
        let capitalToUse = availableBalance * allocationRatio;
        
        let rawQuantity = capitalToUse / currentPrice;
        let quantity = rawQuantity.toFixed(3); 

        console.log(`Tiến hành vào lệnh ${side} mã ${symbol} với số vốn ${capitalToUse} USDT`);

        // 5. CÀI ĐẶT ĐÒN BẨY X1
        const levQuery = `symbol=${symbol}&leverage=1&timestamp=${timestamp}`;
        const levSig = signQuery(levQuery);
        await axios.post(`${baseURL}/fapi/v1/leverage?${levQuery}&signature=${levSig}`, {}, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });

        // 6. GỬI LỆNH MARKET ĐẶT VỊ THẾ
        const orderQuery = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${quantity}&timestamp=${timestamp}`;
        const orderSig = signQuery(orderQuery);
        const orderRes = await axios.post(`${baseURL}/fapi/v1/order?${orderQuery}&signature=${orderSig}`, {}, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });
        console.log("Đặt lệnh thành công:", orderRes.data.orderId);

        // 7. ĐẶT LỆNH TAKE PROFIT (TP) 2%
        let tpPrice = (side === "BUY") ? (currentPrice * 1.02) : (currentPrice * 0.98);
        tpPrice = tpPrice.toFixed(4);

        const closeSide = (side === "BUY") ? "SELL" : "BUY";
        const tpQuery = `symbol=${symbol}&side=${closeSide}&type=TAKE_PROFIT_MARKET&stopPrice=${tpPrice}&closePosition=true&timestamp=${timestamp}`;
        const tpSig = signQuery(tpQuery);
        await axios.post(`${baseURL}/fapi/v1/order?${tpQuery}&signature=${tpSig}`, {}, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });
        console.log(`Đã đặt TP tại mức giá: ${tpPrice}`);

    } catch (error) {
        console.error("Lỗi thực thi bot:", error.response?.data || error.message);
    }
}

runBot();
