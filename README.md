# Ais360 Backend - Vercel Deployment

Flask backend API for Ais360 job estimates with NetSuite integration, deployed as Vercel serverless functions.

## 🚀 Deployment

### Vercel Setup
1. Connect this repository to Vercel
2. Configure environment variables in Vercel dashboard
3. Deploy automatically on push to `vercel-deployment` branch

### Environment Variables
Configure these in Vercel Dashboard → Settings → Environment Variables:

```
NETSUITE_ACCOUNT_ID=your_account_id
NETSUITE_CONSUMER_KEY=your_consumer_key
NETSUITE_CONSUMER_SECRET=your_consumer_secret
NETSUITE_TOKEN_ID=your_token_id
NETSUITE_TOKEN_SECRET=your_token_secret
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
API_SECRET_KEY=your_secure_api_key
FRONTEND_URL=https://your-frontend.vercel.app
```

## 📡 API Endpoints

### Health Check
- **URL**: `/api/health`
- **Method**: GET
- **Headers**: `X-API-Key: your_api_key`

### NetSuite Status
- **URL**: `/api/netsuite/status`
- **Method**: GET
- **Headers**: `X-API-Key: your_api_key`

### Estimate Requests
- **URL**: `/api/netsuite/estimate-requests`
- **Method**: GET
- **Headers**: `X-API-Key: your_api_key`

## 🔒 Security

### API Key Authentication
All endpoints require `X-API-Key` header with valid API key.

### CORS Configuration
CORS is configured to only allow requests from the configured frontend URL.

### Rate Limiting
Implemented at Vercel level and application level.

## 🏗️ Architecture

### Serverless Functions
- Each endpoint is a separate Vercel serverless function
- Functions are stateless and auto-scaling
- Cold start optimization included

### File Structure
```
api/
├── health.py              # Health check endpoint
└── netsuite/
    ├── status.py          # NetSuite configuration status
    └── estimate-requests.py # Fetch estimate requests from NetSuite
```

## 🔧 Local Development

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. Test with Vercel CLI:
   ```bash
   vercel dev
   ```

## 📝 Notes

- Functions automatically handle CORS
- All functions validate API keys
- NetSuite OAuth 1.0 signature generation included
- Error handling and logging implemented
- Compatible with Vercel's Python 3.9 runtime

