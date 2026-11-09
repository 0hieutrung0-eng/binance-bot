const axios = require('axios');
const crypto = require('crypto');
const { HttpsProxyAgent } = require('https-proxy-agent');

const apiKey = process.env.BINANCE_API_KEY;
const apiSecret = process.env.BINANCE_API_SECRET;
const proxyUrl = process.env.PROXY_URL; // Lấy Proxy từ GitHub Secrets
const baseURL = 'https://fapi.binance.com';

// Cấu hình Proxy Agent nếu có
const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
const apiClient = axios.create({
    baseURL: baseURL,
    httpsAgent: agent,
    proxy: false
});

function signQuery(queryString) {
    return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

async function runBot() {
    try {
        const timestamp = Date.now();

        // 1. KIỂM TRA VỊ THẾ ĐANG MỞ
        const posQuery = `timestamp=${timestamp}`;
        const posSig = signQuery(posQuery);
        const posRes = await apiClient.get(`/fapi/v2/positionRisk?${posQuery}&signature=${posSig}`, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });

        const activePositions = posRes.data.filter(p => parseFloat(p.positionAmt) !== 0);
        if (activePositions.length > 0) {
            console.log("Đang có lệnh treo trên sàn, bỏ qua chu kỳ này.");
            return;
        }

        // 2. LẤY SỐ DƯ TÀI KHOẢN
        const accQuery = `timestamp=${timestamp}`;
        const accSig = signQuery(accQuery);
        const accRes = await apiClient.get(`/fapi/v2/account?${accQuery}&signature=${accSig}`, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });
        const availableBalance = parseFloat(accRes.data.availableBalance);

        // 3. LẤY DỮ LIỆU 24H TICKER TỪ BINANCE
        const tickerRes = await apiClient.get(`/fapi/v1/ticker/24hr`);
        let tickers = tickerRes.data.filter(t => t.symbol.endsWith('USDT'));

        tickers.sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));

        const top5Gainers = tickers.slice(0, 5);

        // 4. CHỌN COIN & HƯỚNG ĐÁNH
        let chosenCoin = top5Gainers[0]; 
        let symbol = chosenCoin.symbol;
        let currentPrice = parseFloat(chosenCoin.lastPrice);
        let side = "BUY"; // "BUY" cho Long, "SELL" cho Short

        let allocationRatio = (side === "BUY") ? 0.95 : 0.50;
        let capitalToUse = availableBalance * allocationRatio;
        let quantity = (capitalToUse / currentPrice).toFixed(3);

        console.log(`Tiến hành vào lệnh ${side} mã ${symbol} với số vốn ${capitalToUse} USDT`);

        // 5. CÀI ĐẶT ĐÒN BẨY X1
        const levQuery = `symbol=${symbol}&leverage=1&timestamp=${timestamp}`;
        const levSig = signQuery(levQuery);
        await apiClient.post(`/fapi/v1/leverage?${levQuery}&signature=${levSig}`, {}, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });

        // 6. GỬI LỆNH MARKET ĐẶT VỊ THẾ
        const orderQuery = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${quantity}&timestamp=${timestamp}`;
        const orderSig = signQuery(orderQuery);
        const orderRes = await apiClient.post(`/fapi/v1/order?${orderQuery}&signature=${orderSig}`, {}, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });
        console.log("Đặt lệnh thành công:", orderRes.data.orderId);

        // 7. ĐẶT LỆNH TAKE PROFIT (TP) 2%
        let tpPrice = (side === "BUY") ? (currentPrice * 1.02) : (currentPrice * 0.98);
        tpPrice = tpPrice.toFixed(4);

        const closeSide = (side === "BUY") ? "SELL" : "BUY";
        const tpQuery = `symbol=${symbol}&side=${closeSide}&type=TAKE_PROFIT_MARKET&stopPrice=${tpPrice}&closePosition=true&timestamp=${timestamp}`;
        const tpSig = signQuery(tpQuery);
        await apiClient.post(`/fapi/v1/order?${tpQuery}&signature=${tpSig}`, {}, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });
        console.log(`Đã đặt TP tại mức giá: ${tpPrice}`);

    } catch (error) {
        console.error("Lỗi thực thi bot:", error.response?.data || error.message);
    }
}

runBot();
