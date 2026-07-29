// Connection status for the Settings screen. Never returns key values.
exports.handler = async () => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    claude: !!process.env.ANTHROPIC_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    maps: !!process.env.GOOGLE_MAPS_API_KEY,
  }),
});
