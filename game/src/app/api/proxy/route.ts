import { NextRequest, NextResponse } from 'next/server';
import * as dns from 'dns';
import { promisify } from 'util';

const lookup = promisify(dns.lookup);

/**
 * Checks if the given IP address belongs to a private subnet (Wi-Fi/local network).
 */
function isPrivateSubnet(ip: string): boolean {
  const normalized = ip.trim().toLowerCase();
  
  if (
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(normalized)
  ) {
    return true;
  }
  
  if (
    normalized.startsWith('fc00:') ||
    normalized.startsWith('fd00:')
  ) {
    return true;
  }
  
  return false;
}

/**
 * Checks if the given IP address is loopback or link-local.
 * This is crucial to prevent SSRF (Server-Side Request Forgery) attacks on the host.
 */
function isLoopbackOrLinkLocal(ip: string): boolean {
  const normalized = ip.trim().toLowerCase();
  
  if (
    normalized === 'localhost' ||
    normalized === '0.0.0.0' ||
    normalized.startsWith('127.') ||
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('169.254.') ||
    normalized.startsWith('fe80:')
  ) {
    return true;
  }
  
  return false;
}

/**
 * Validates that the endpoint URL is either a public HTTPS address or a local/private HTTP address.
 */
async function isSafeUrl(urlStr: string): Promise<boolean> {
  try {
    const url = new URL(urlStr);
    
    // Only allow http and https protocols
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return false;
    }
    
    const hostname = url.hostname;
    
    // Block loopback or link-local directly at hostname level
    if (isLoopbackOrLinkLocal(hostname)) {
      return false;
    }
    
    // Resolve DNS to verify the target IP address
    const result = await lookup(hostname);
    const ip = result.address;
    
    // Block resolved loopback or link-local IPs
    if (isLoopbackOrLinkLocal(ip)) {
      return false;
    }
    
    // If protocol is HTTP, enforce that it must be a private/Wi-Fi subnet IP
    if (url.protocol === 'http:' && !isPrivateSubnet(ip)) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

// Whitelist of request headers safe to forward to the target LLM
const ALLOWED_HEADERS = [
  'authorization',
  'api-key',
  'x-api-key',
  'http-referer',
  'x-title',
  'accept',
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { endpoint, headers = {}, body: payload } = body;

    if (!endpoint || typeof endpoint !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid endpoint parameter' },
        { status: 400 }
      );
    }

    // SSRF Validation
    const safe = await isSafeUrl(endpoint);
    if (!safe) {
      return NextResponse.json(
        { error: 'Forbidden endpoint URL (must be a public HTTPS URL)' },
        { status: 403 }
      );
    }

    // Filter and sanitize request headers
    const reqHeaders = new Headers();
    reqHeaders.set('Content-Type', 'application/json');
    
    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (ALLOWED_HEADERS.includes(lowerKey) && typeof value === 'string') {
        reqHeaders.set(lowerKey, value);
      }
    }

    // Make the proxied request to the LLM API
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(payload),
    });

    // Extract content type to preserve streaming format if present (e.g. text/event-stream)
    const responseHeaders = new Headers();
    const contentType = response.headers.get('Content-Type');
    if (contentType) {
      responseHeaders.set('Content-Type', contentType);
    }
    
    // Return standard/streaming response
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error('Proxy Error:', error);
    return NextResponse.json(
      { error: 'Internal server error in LLM proxy', details: error.message },
      { status: 500 }
    );
  }
}
