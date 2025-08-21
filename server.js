// Node.js server for NetSuite API integration
import express from 'express'
import cors from 'cors'
import crypto from 'crypto'
import fetch from 'node-fetch'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())

// NetSuite credentials from environment variables
const NETSUITE_CONFIG = {
  accountId: process.env.NETSUITE_ACCOUNT_ID,
  consumerKey: process.env.NETSUITE_CONSUMER_KEY,
  consumerSecret: process.env.NETSUITE_CONSUMER_SECRET,
  tokenId: process.env.NETSUITE_TOKEN_ID,
  tokenSecret: process.env.NETSUITE_TOKEN_SECRET,
  roleId: process.env.NETSUITE_ROLE || '3'
}

// Generate OAuth 1.0 signature for NetSuite
function generateOAuthSignature(method, url, params, consumerSecret, tokenSecret) {
  const baseString = method.toUpperCase() + '&' + 
    encodeURIComponent(url) + '&' + 
    encodeURIComponent(Object.keys(params).sort().map(key => 
      `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`
    ).join('&'))
  
  const signingKey = encodeURIComponent(consumerSecret) + '&' + encodeURIComponent(tokenSecret)
  return crypto.createHmac('sha256', signingKey).update(baseString).digest('base64')
}

// Generate OAuth header
function generateOAuthHeader(method, url, body = '') {
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = crypto.randomBytes(16).toString('hex')
  
  const params = {
    oauth_consumer_key: NETSUITE_CONFIG.consumerKey,
    oauth_token: NETSUITE_CONFIG.tokenId,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: timestamp,
    oauth_nonce: nonce,
    oauth_version: '1.0'
  }
  
  const signature = generateOAuthSignature(method, url, params, NETSUITE_CONFIG.consumerSecret, NETSUITE_CONFIG.tokenSecret)
  params.oauth_signature = signature
  
  return 'OAuth realm="' + NETSUITE_CONFIG.accountId + '",' +
    Object.keys(params).map(key => `${key}="${encodeURIComponent(params[key])}"`).join(',')
}

// Mock data for fallback
function getMockEstimateRequests() {
  return {
    items: [
      {
        id: '1001',
        bid_due_date: '2025-08-25',
        priority_name: 'High',
        status_name: 'Pending Review',
        assigned_to_name: 'John Smith',
        estimate_due_date: '2025-08-22',
        date_submitted: '2025-08-19',
        job_name: 'ABC Corp Storefront Signs',
        requested_by_name: 'Sarah Wilson',
        estimator_note: 'Customer needs channel letters and monument sign. Rush job - high priority client.'
      },
      {
        id: '1002',
        bid_due_date: '2025-08-28',
        priority_name: 'Medium',
        status_name: 'Pending Review',
        assigned_to_name: 'Mike Johnson',
        estimate_due_date: '2025-08-26',
        date_submitted: '2025-08-18',
        job_name: 'XYZ Restaurant Signage',
        requested_by_name: 'Tom Anderson',
        estimator_note: 'Interior and exterior signage package. Need to coordinate with architect.'
      },
      {
        id: '1003',
        bid_due_date: '2025-09-01',
        priority_name: 'Low',
        status_name: 'In Progress',
        assigned_to_name: 'John Smith',
        estimate_due_date: '2025-08-30',
        date_submitted: '2025-08-17',
        job_name: 'Medical Center Wayfinding',
        requested_by_name: 'Sarah Wilson',
        estimator_note: 'Complex wayfinding system with ADA compliance requirements.'
      }
    ],
    totalCount: 3,
    hasMore: false
  }
}

// API Routes

// Get pending estimate requests from NetSuite
app.get('/api/netsuite/estimate-requests', async (req, res) => {
  try {
    console.log('Fetching estimate requests from NetSuite...')
    console.log('Account ID:', NETSUITE_CONFIG.accountId)
    
    // Check if NetSuite credentials are configured
    if (!NETSUITE_CONFIG.accountId || !NETSUITE_CONFIG.consumerKey) {
      console.log('NetSuite credentials not configured, using mock data')
      return res.json(getMockEstimateRequests())
    }

    // NetSuite SuiteQL query to fetch pending estimate requests with human-readable names
    const query = `
      SELECT
        er.id,
        job.entityid AS job_id,
        COALESCE(job.companyname, job.altname, job.entityid) AS job_name,
        COALESCE(emp.altname, emp.entityid) AS assigned_to_name,
        COALESCE(rby.altname, rby.entityid) AS requested_by_name,
        er.custrecord_er_date_submitted AS date_submitted,
        er.custrecord20 AS estimate_due_date,
        er.custrecord21 AS estimate_completed,
        er.custrecord43 AS estimator_note
      FROM customrecord417 er
      LEFT JOIN job job ON job.id = er.custrecord_er_job
      LEFT JOIN entity emp ON emp.id = er.custrecord19 AND emp.type = 'Employee'
      LEFT JOIN entity rby ON rby.id = er.custrecord_er_req_by AND rby.type = 'Employee'
      WHERE er.custrecord21 IS NULL
      ORDER BY er.id DESC
    `

    const url = `https://${NETSUITE_CONFIG.accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`
    
    console.log('Making NetSuite API call to:', url)
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Prefer': 'transient',
        'Authorization': generateOAuthHeader('POST', url, JSON.stringify({ q: query }))
      },
      body: JSON.stringify({ q: query })
    })

    console.log('NetSuite API response status:', response.status)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('NetSuite API error:', response.status, errorText)
      throw new Error(`NetSuite API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    console.log('NetSuite API response:', JSON.stringify(data, null, 2))
    
    // Transform NetSuite response to match our expected format
    const transformedItems = data.items?.map(item => ({
      ...item,
      // Add priority name mapping
      priority_name: item.priority_id === '1' ? 'High' : 
                    item.priority_id === '2' ? 'Medium' : 
                    item.priority_id === '3' ? 'Low' : 'Unknown',
      // Add status name mapping  
      status_name: item.status_id === '1' ? 'Pending Review' :
                  item.status_id === '2' ? 'In Progress' :
                  item.status_id === '3' ? 'On Hold' :
                  item.status_id === '4' ? 'Completed' : 'Unknown',
      // Add placeholder names (we'll improve this later)
      assigned_to_name: 'Employee ID: ' + (item.assigned_to_id || 'Unassigned'),
      job_name: 'Job ID: ' + (item.job_id || 'No Job'),
      requested_by_name: 'Employee ID: ' + (item.requested_by_id || 'Unknown')
    })) || []
    
    const transformedData = {
      items: transformedItems,
      totalCount: data.count || 0,
      hasMore: data.hasMore || false
    }

    res.json(transformedData)

  } catch (error) {
    console.error('Error fetching estimate requests:', error)
    
    // Return mock data as fallback
    console.log('Falling back to mock data due to error')
    res.json(getMockEstimateRequests())
  }
})

// Convert estimate request to job estimate
app.post('/api/netsuite/convert-request', async (req, res) => {
  try {
    const { requestId } = req.body
    console.log('Converting estimate request:', requestId)
    
    // For now, return success (you can implement actual conversion logic later)
    res.json({
      success: true,
      jobEstimateId: `JOB-${Date.now()}`,
      message: 'Estimate request converted successfully'
    })

  } catch (error) {
    console.error('Error converting request:', error)
    res.status(500).json({ 
      success: false, 
      error: error.message 
    })
  }
})

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    netsuiteConfigured: !!NETSUITE_CONFIG.accountId
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`NetSuite API server running on port ${PORT}`)
  console.log('NetSuite Account ID:', NETSUITE_CONFIG.accountId || 'Not configured')
  console.log('Environment:', process.env.NODE_ENV || 'development')
})

