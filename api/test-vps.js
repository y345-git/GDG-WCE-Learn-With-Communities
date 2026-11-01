export default async function handler(req, res) {
    try {
        const t0 = Date.now();
        const vpsRes = await fetch('http://62.84.172.73:3000/api/health', { signal: AbortSignal.timeout(5000) });
        const text = await vpsRes.text();
        return res.status(200).json({
            success: true,
            elapsedMs: Date.now() - t0,
            status: vpsRes.status,
            body: JSON.parse(text)
        });
    } catch (e) {
        return res.status(500).json({
            success: false,
            error: e.message,
            code: e.code,
            cause: String(e.cause)
        });
    }
}
