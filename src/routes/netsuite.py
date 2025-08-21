import os
import json
import hashlib
import hmac
import base64
import urllib.parse
import time
import requests
from flask import Blueprint, jsonify
from dotenv import load_dotenv

# Load environment variables from the project root
project_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
env_path = os.path.join(project_root, '.env')
print(f"Loading .env from: {env_path}")
print(f"File exists: {os.path.exists(env_path)}")
load_dotenv(env_path)

# Debug: Print loaded environment variables
print(f"NETSUITE_ACCOUNT_ID: {os.getenv('NETSUITE_ACCOUNT_ID')}")
print(f"NETSUITE_CONSUMER_KEY: {os.getenv('NETSUITE_CONSUMER_KEY')[:10]}..." if os.getenv('NETSUITE_CONSUMER_KEY') else "None")

netsuite_bp = Blueprint('netsuite', __name__)

# NetSuite configuration - hardcoded for deployment
NETSUITE_CONFIG = {
    'account_id': '3630411',
    'consumer_key': '5d8c2f4f30545722b7c9a7741db632ea7a126a6c21c36dd51df55e04922d499e',
    'consumer_secret': 'c885e54eed11b3eedaed9ecf287099b5a50acd29e29fe866265b4f3b07a0cf83',
    'token_id': 'ae64e3f1c5581710ba0859a506e79bd400420d00b21641da9f00be7a9164ef95',
    'token_secret': 'd3abce3a6d9ecafe6508d37a3a6194c1bc8269a1d3a8540a0c705dcecb82c98c',
    'role': '3'
}

def generate_oauth_signature(method, url, params, consumer_secret, token_secret):
    """Generate OAuth 1.0 signature for NetSuite API - Fixed to match working implementation"""
    # Sort parameters
    sorted_params = sorted(params.items())
    
    # Create parameter string
    param_string = '&'.join([f"{urllib.parse.quote(str(k), safe='')}={urllib.parse.quote(str(v), safe='')}" for k, v in sorted_params])
    
    # Create signature base string
    signature_base = f"{method.upper()}&{urllib.parse.quote(url, safe='')}&{urllib.parse.quote(param_string, safe='')}"
    
    # Create signing key
    signing_key = f"{urllib.parse.quote(consumer_secret, safe='')}&{urllib.parse.quote(token_secret, safe='')}"
    
    # Generate signature using HMAC-SHA256 (matching working script)
    signature = base64.b64encode(hmac.new(signing_key.encode(), signature_base.encode(), hashlib.sha256).digest()).decode()
    
    return signature

def make_netsuite_request(query):
    """Make a request to NetSuite SuiteQL API - Fixed to match working implementation"""
    try:
        # NetSuite SuiteQL endpoint
        url = f"https://{NETSUITE_CONFIG['account_id']}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql"
        
        # OAuth parameters
        oauth_params = {
            'oauth_consumer_key': NETSUITE_CONFIG['consumer_key'],
            'oauth_token': NETSUITE_CONFIG['token_id'],
            'oauth_signature_method': 'HMAC-SHA256',
            'oauth_timestamp': str(int(time.time())),
            'oauth_nonce': str(int(time.time() * 1000)),
            'oauth_version': '1.0'
        }
        
        # Generate signature
        signature = generate_oauth_signature('POST', url, oauth_params, NETSUITE_CONFIG['consumer_secret'], NETSUITE_CONFIG['token_secret'])
        oauth_params['oauth_signature'] = signature
        
        # Create Authorization header with realm (CRITICAL - this was missing!)
        realm = NETSUITE_CONFIG['account_id']
        oauth_header_parts = [f'{k}="{v}"' for k, v in oauth_params.items()]
        auth_header = f'OAuth realm="{realm}", ' + ', '.join(oauth_header_parts)
        
        # Request headers (matching working script exactly)
        headers = {
            'Authorization': auth_header,
            'Content-Type': 'application/json',
            'Prefer': 'transient'
        }
        
        # Request body
        data = {
            'q': query
        }
        
        # Make the request
        response = requests.post(url, headers=headers, json=data, timeout=30)
        
        if response.status_code == 200:
            return response.json()
        else:
            print(f"NetSuite API Error: {response.status_code}")
            print(f"Response: {response.text}")
            return None
            
    except Exception as e:
        print(f"NetSuite Request Error: {str(e)}")
        return None

@netsuite_bp.route('/estimate-requests', methods=['GET'])
def get_estimate_requests():
    """Get estimate requests from NetSuite CUSTOMRECORD417"""
    try:
        # SQL query to get estimate requests - using tested query from working script
        query = """
        SELECT 
            er.id,
            er.custrecord_er_job AS job_id,
            job.entityid AS job_name,
            er.custrecord19 AS assigned_to_id,
            COALESCE(emp.altname, emp.entityid) AS assigned_to_name,
            er.custrecord_er_req_by AS requested_by_id,
            COALESCE(rby.altname, rby.entityid) AS requested_by_name,
            er.custrecord12 AS bid_due_date,
            er.custrecord17 AS priority_id,
            er.custrecord18 AS status_id,
            er.custrecord20 AS estimate_due_date,
            er.custrecord21 AS estimate_completed,
            er.custrecord_er_date_submitted AS date_submitted,
            er.custrecord43 AS estimator_note,
            er.custrecord_er_job_desc AS job_description,
            er.custrecord31 AS performance_bond,
            er.custrecord32 AS performance_bond_amount,
            er.custrecord34 AS liquidated_damages,
            er.custrecord35 AS liquidated_damages_amount,
            er.custrecord27 AS union_labor,
            er.custrecord28 AS mbe_wbe,
            er.custrecord13 AS rfi_due_date,
            er.custrecord38 AS box_folder_link,
            er.custrecord39 AS completed_estimate_link,
            er.custrecord40 AS completed_estimate_amount,
            er.custrecord36 AS job_status
        FROM 
            customrecord417 er
        LEFT JOIN 
            job job ON job.id = er.custrecord_er_job
        LEFT JOIN 
            entity emp ON emp.id = er.custrecord19 AND emp.type = 'Employee'
        LEFT JOIN 
            entity rby ON rby.id = er.custrecord_er_req_by AND rby.type = 'Employee'
        WHERE 
            er.custrecord21 IS NULL
        ORDER BY er.id DESC
        FETCH NEXT 10 ROWS ONLY
        """
        
        # Make NetSuite API request
        result = make_netsuite_request(query)
        
        if result and 'items' in result:
            # Transform the data for frontend consumption
            estimate_requests = []
            for item in result['items']:
                estimate_requests.append({
                    'id': item.get('id'),
                    'job_id': item.get('job_id'),
                    'job_name': item.get('job_name') or f"Job ID: {item.get('job_id')}",
                    'assigned_to': item.get('assigned_to_name') or f"Employee ID: {item.get('assigned_to_id')}" if item.get('assigned_to_id') else 'Unassigned',
                    'requested_by': item.get('requested_by_name') or f"Employee ID: {item.get('requested_by_id')}" if item.get('requested_by_id') else 'Unknown',
                    'estimate_due_date': item.get('estimate_due_date'),
                    'estimate_completed': item.get('estimate_completed'),
                    'date_submitted': item.get('date_submitted'),
                    'bid_due_date': item.get('bid_due_date'),
                    'priority_id': item.get('priority_id'),
                    'status_id': item.get('status_id'),
                    'estimator_note': item.get('estimator_note'),
                    'job_description': item.get('job_description'),
                    'performance_bond': item.get('performance_bond'),
                    'performance_bond_amount': item.get('performance_bond_amount'),
                    'liquidated_damages': item.get('liquidated_damages'),
                    'liquidated_damages_amount': item.get('liquidated_damages_amount'),
                    'union_labor': item.get('union_labor'),
                    'prevailing_wage': item.get('prevailing_wage'),
                    'mbe_wbe': item.get('mbe_wbe'),
                    'rfi_due_date': item.get('rfi_due_date'),
                    'box_folder_link': item.get('box_folder_link'),
                    'completed_estimate_link': item.get('completed_estimate_link'),
                    'completed_estimate_amount': item.get('completed_estimate_amount'),
                    'job_status': item.get('job_status')
                })
            
            return jsonify({
                'success': True,
                'data': estimate_requests,
                'count': len(estimate_requests)
            })
        else:
            # No data returned from NetSuite
            return jsonify({
                'success': False,
                'error': 'No data returned from NetSuite API',
                'data': [],
                'count': 0
            })
        
    except Exception as e:
        print(f"NetSuite API Error: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'NetSuite API Error: {str(e)}',
            'data': [],
            'count': 0
        })

@netsuite_bp.route('/status', methods=['GET'])
def get_status():
    """Get NetSuite integration status"""
    is_configured = all([
        NETSUITE_CONFIG['account_id'],
        NETSUITE_CONFIG['consumer_key'],
        NETSUITE_CONFIG['consumer_secret'],
        NETSUITE_CONFIG['token_id'],
        NETSUITE_CONFIG['token_secret']
    ])
    
    return jsonify({
        'status': 'OK',
        'netsuite_configured': is_configured,
        'account_id': NETSUITE_CONFIG['account_id'],
        'timestamp': time.time()
    })

