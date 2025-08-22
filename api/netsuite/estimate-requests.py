from flask import Flask, jsonify, request
from flask_cors import CORS
import os
import json
import hashlib
import hmac
import base64
import urllib.parse
import time
import requests

app = Flask(__name__)

def validate_api_key(request):
    """Validate API key from request headers"""
    api_key = request.headers.get('X-API-Key')
    expected_key = os.environ.get('API_SECRET_KEY')
    return api_key and api_key == expected_key

def generate_oauth_signature(method, url, params, consumer_secret, token_secret):
    """Generate OAuth 1.0 signature for NetSuite API"""
    # Sort parameters
    sorted_params = sorted(params.items())
    
    # Create parameter string
    param_string = '&'.join([f"{urllib.parse.quote(str(k), safe='')}={urllib.parse.quote(str(v), safe='')}" for k, v in sorted_params])
    
    # Create signature base string
    signature_base = f"{method.upper()}&{urllib.parse.quote(url, safe='')}&{urllib.parse.quote(param_string, safe='')}"
    
    # Create signing key
    signing_key = f"{urllib.parse.quote(consumer_secret, safe='')}&{urllib.parse.quote(token_secret, safe='')}"
    
    # Generate signature using HMAC-SHA256
    signature = base64.b64encode(hmac.new(signing_key.encode(), signature_base.encode(), hashlib.sha256).digest()).decode()
    
    return signature

def make_netsuite_request():
    """Make authenticated request to NetSuite API"""
    try:
        # NetSuite configuration from environment
        config = {
            'account_id': os.environ.get('NETSUITE_ACCOUNT_ID'),
            'consumer_key': os.environ.get('NETSUITE_CONSUMER_KEY'),
            'consumer_secret': os.environ.get('NETSUITE_CONSUMER_SECRET'),
            'token_id': os.environ.get('NETSUITE_TOKEN_ID'),
            'token_secret': os.environ.get('NETSUITE_TOKEN_SECRET'),
            'role': '3'
        }
        
        # Validate configuration
        if not all(config.values()):
            raise Exception("Missing NetSuite configuration")
        
        # API endpoint
        base_url = f"https://{config['account_id']}.suitetalk.api.netsuite.com"
        endpoint = "/services/rest/query/v1/suiteql"
        url = base_url + endpoint
        
        # SQL query for estimate requests
        sql_query = '''
        SELECT 
            er.id,
            er.custrecord_er_job AS job_id,
            COALESCE(job.companyname, job.altname, job.entityid) AS job_name,
            COALESCE(emp.altname, emp.entityid) AS assigned_to,
            emp.id AS assigned_to_id,
            COALESCE(req_emp.altname, req_emp.entityid) AS requested_by,
            req_emp.id AS requested_by_id,
            er.custrecord21 AS bid_due_date,
            er.custrecord_er_priority AS priority_id,
            er.custrecord_er_status AS status_id,
            er.custrecord_er_est_due_date AS estimate_due_date,
            er.custrecord_er_est_completed AS estimate_completed,
            er.custrecord_er_date_submitted AS date_submitted,
            er.custrecord_er_estimator_note AS estimator_note,
            er.custrecord_er_job_description AS job_description,
            er.custrecord_er_performance_bond AS performance_bond,
            er.custrecord_er_performance_bond_amount AS performance_bond_amount,
            er.custrecord_er_liquidated_damages AS liquidated_damages,
            er.custrecord_er_liquidated_damages_amount AS liquidated_damages_amount,
            er.custrecord_er_union_labor AS union_labor,
            er.custrecord_er_prevailing_wage AS prevailing_wage,
            er.custrecord_er_mbe_wbe AS mbe_wbe,
            er.custrecord_er_rfi_due_date AS rfi_due_date,
            er.custrecord_er_box_folder_link AS box_folder_link,
            er.custrecord_er_completed_estimate_link AS completed_estimate_link,
            er.custrecord_er_completed_estimate_amount AS completed_estimate_amount,
            job.entitystatus AS job_status
        FROM 
            customrecord417 er
        LEFT JOIN 
            job ON er.custrecord_er_job = job.id
        LEFT JOIN 
            employee emp ON er.custrecord_er_assigned_to = emp.id
        LEFT JOIN 
            employee req_emp ON er.custrecord_er_requested_by = req_emp.id
        WHERE 
            er.custrecord21 IS NULL
        ORDER BY 
            er.custrecord_er_est_due_date ASC
        '''
        
        # OAuth parameters
        oauth_params = {
            'oauth_consumer_key': config['consumer_key'],
            'oauth_token': config['token_id'],
            'oauth_signature_method': 'HMAC-SHA256',
            'oauth_timestamp': str(int(time.time())),
            'oauth_nonce': str(int(time.time() * 1000)),
            'oauth_version': '1.0'
        }
        
        # Generate signature
        signature = generate_oauth_signature('POST', url, oauth_params, config['consumer_secret'], config['token_secret'])
        oauth_params['oauth_signature'] = signature
        
        # Create Authorization header with realm
        auth_header = 'OAuth realm="' + config['account_id'] + '"'
        for key, value in oauth_params.items():
            auth_header += f', {key}="{urllib.parse.quote(str(value), safe="")}"'
        
        # Request headers
        headers = {
            'Authorization': auth_header,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        
        # Request payload
        payload = {
            'q': sql_query
        }
        
        # Make request
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            items = data.get('items', [])
            
            return {
                "success": True,
                "count": len(items),
                "data": items
            }
        else:
            print(f"NetSuite API Error: {response.status_code}")
            print(f"Response: {response.text}")
            return {
                "success": False,
                "error": f"NetSuite API error: {response.status_code}",
                "count": 0,
                "data": []
            }
            
    except Exception as e:
        print(f"Error making NetSuite request: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "count": 0,
            "data": []
        }

def handler(request):
    """NetSuite estimate requests endpoint for Vercel"""
    
    # Validate API key
    if not validate_api_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        return '', 200
    
    try:
        # Make NetSuite request
        result = make_netsuite_request()
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "count": 0,
            "data": []
        }), 500

# Configure CORS
@app.after_request
def after_request(response):
    frontend_url = os.environ.get('FRONTEND_URL', 'http://localhost:5173')
    response.headers.add('Access-Control-Allow-Origin', frontend_url)
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

