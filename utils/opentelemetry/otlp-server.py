#!/usr/bin/env python3

"""
A simple OTLP (OpenTelemetry Protocol) test server that logs received traces.

This server accepts OTLP traces over HTTP POST requests to /v1/traces endpoint
and logs the received data in a human-readable format.

Example use:
  python3 otlp-server.py

The server will listen on http://localhost:4318 by default.
You can configure the port with the --port argument.

Example use from browser:
  Set VITE_OPENTELEMETRY_ENDPOINT=http://localhost:4318/v1/traces
"""

import argparse
import json
import logging
import os
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

BIND_ADDRESS = '0.0.0.0'
DEFAULT_PORT = 4318
LOG_DIR = Path(os.environ.get('TMPDIR', '/tmp')) / 'ecmaos' / 'logs'

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class OTLPHandler(BaseHTTPRequestHandler):
    """HTTP request handler for OTLP traces endpoint."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
    
    def handle_one_request(self):
        """Override to log each request attempt."""
        try:
            super().handle_one_request()
        except Exception as e:
            logger.error(f'Error in handle_one_request: {e}', exc_info=True)
            raise
    
    def handle(self):
        """Override handle to log all connections."""
        logger.info(f'New connection from {self.client_address}')
        try:
            super().handle()
        except BrokenPipeError:
            logger.warning(f'Client {self.client_address} disconnected (broken pipe)')
        except Exception as e:
            logger.error(f'Error handling request: {e}', exc_info=True)
        finally:
            logger.info(f'Connection from {self.client_address} closed')

    def _send_cors_headers(self):
        """Send CORS headers for cross-origin requests."""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Accept')
        self.send_header('Access-Control-Max-Age', '3600')

    def do_OPTIONS(self):
        """Handle CORS preflight requests."""
        logger.info(f'Received OPTIONS request to {self.path}')
        logger.info(f'OPTIONS Headers: {dict(self.headers)}')
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()
        logger.info('OPTIONS response sent')

    def do_GET(self):
        """Handle GET requests for health check."""
        parsed_path = urlparse(self.path)
        
        if parsed_path.path == '/health' or parsed_path.path == '/':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({
                'status': 'ok',
                'service': 'otlp-server',
                'endpoint': '/v1/traces'
            }).encode())
            return
        
        self.send_response(404)
        self.send_header('Content-Type', 'application/json')
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps({'error': 'Not found'}).encode())

    def do_POST(self):
        """Handle POST requests to /v1/traces endpoint."""
        parsed_path = urlparse(self.path)
        
        logger.info(f'Received POST request to {self.path}')
        logger.info(f'Headers: {dict(self.headers)}')
        
        if parsed_path.path != '/v1/traces':
            logger.warning(f'404: Path {parsed_path.path} not found')
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'Not found'}).encode())
            return

        content_length_header = self.headers.get('Content-Length')
        content_length = int(content_length_header) if content_length_header else 0
        content_type = self.headers.get('Content-Type', '')
        
        logger.info(f'Content-Type: {content_type}')
        logger.info(f'Content-Length header: {content_length_header}')
        
        # sendBeacon may not send Content-Length, so read available data
        if content_length == 0:
            # Try to read what's available (for sendBeacon)
            try:
                body = self.rfile.read()
                if len(body) == 0:
                    logger.warning('Empty request body received')
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({'status': 'ok', 'message': 'Empty body'}).encode())
                    return
                content_length = len(body)
                logger.info(f'Read {content_length} bytes without Content-Length header (likely sendBeacon)')
            except Exception as e:
                logger.error(f'Error reading request body: {e}')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'ok', 'error': 'Failed to read body'}).encode())
                return
        else:
            try:
                body = self.rfile.read(content_length)
            except Exception as e:
                logger.error(f'Error reading request body: {e}')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'ok', 'error': 'Failed to read body'}).encode())
                return
        
        logger.info(f'Successfully read {len(body)} bytes')
        
        try:
            if 'application/json' in content_type:
                data = json.loads(body.decode('utf-8'))
                self._log_traces(data)
                self._save_traces_to_file(data)
            elif 'application/x-protobuf' in content_type or 'application/octet-stream' in content_type:
                logger.info('Received Protobuf data (not decoded, showing hex):')
                logger.info(f'  {body.hex()[:100]}...' if len(body) > 100 else f'  {body.hex()}')
            else:
                logger.info(f'Received data with unknown content type: {content_type}')
                logger.info(f'  First 200 bytes: {body[:200]}')
        except Exception as e:
            logger.error(f'Error processing request: {e}', exc_info=True)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'error', 'error': str(e)}).encode())
            return

        try:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_headers()
            self.end_headers()
            response = json.dumps({'status': 'ok'}).encode()
            self.wfile.write(response)
            self.wfile.flush()
            logger.info('Response sent successfully')
        except Exception as e:
            logger.error(f'Error sending response: {e}', exc_info=True)

    def _log_traces(self, data: dict) -> None:
        """Log trace data in a human-readable format."""
        logger.info('=' * 80)
        logger.info('Received OTLP Trace Data:')
        logger.info('=' * 80)
        
        resource_spans = data.get('resourceSpans', [])
        logger.info(f'Number of resource spans: {len(resource_spans)}')
        
        for idx, resource_span in enumerate(resource_spans):
            logger.info(f'\n--- Resource Span {idx + 1} ---')
            
            resource = resource_span.get('resource', {})
            attributes = resource.get('attributes', [])
            if attributes:
                logger.info('Resource Attributes:')
                for attr in attributes:
                    key = attr.get('key', '')
                    value = attr.get('value', {})
                    logger.info(f'  {key}: {self._format_value(value)}')
            
            scope_spans = resource_span.get('scopeSpans', [])
            logger.info(f'Number of scope spans: {len(scope_spans)}')
            
            for scope_idx, scope_span in enumerate(scope_spans):
                logger.info(f'\n  --- Scope Span {scope_idx + 1} ---')
                
                scope = scope_span.get('scope', {})
                if scope:
                    logger.info(f'  Scope Name: {scope.get("name", "unknown")}')
                    logger.info(f'  Scope Version: {scope.get("version", "unknown")}')
                
                spans = scope_span.get('spans', [])
                logger.info(f'  Number of spans: {len(spans)}')
                
                for span_idx, span in enumerate(spans):
                    logger.info(f'\n    --- Span {span_idx + 1} ---')
                    logger.info(f'    Trace ID: {span.get("traceId", "unknown")}')
                    logger.info(f'    Span ID: {span.get("spanId", "unknown")}')
                    logger.info(f'    Name: {span.get("name", "unknown")}')
                    logger.info(f'    Kind: {span.get("kind", "unknown")}')
                    logger.info(f'    Start Time: {span.get("startTimeUnixNano", "unknown")}')
                    logger.info(f'    End Time: {span.get("endTimeUnixNano", "unknown")}')
                    
                    duration = None
                    if 'startTimeUnixNano' in span and 'endTimeUnixNano' in span:
                        try:
                            start = int(span['startTimeUnixNano'])
                            end = int(span['endTimeUnixNano'])
                            duration = (end - start) / 1_000_000
                            logger.info(f'    Duration: {duration:.2f} ms')
                        except (ValueError, TypeError):
                            pass
                    
                    attributes = span.get('attributes', [])
                    if attributes:
                        logger.info('    Attributes:')
                        for attr in attributes:
                            key = attr.get('key', '')
                            value = attr.get('value', {})
                            logger.info(f'      {key}: {self._format_value(value)}')
                    
                    events = span.get('events', [])
                    if events:
                        logger.info(f'    Events ({len(events)}):')
                        for event in events:
                            logger.info(f'      - {event.get("name", "unknown")} at {event.get("timeUnixNano", "unknown")}')
                    
                    status = span.get('status', {})
                    if status:
                        code = status.get('code', 'unknown')
                        message = status.get('message', '')
                        logger.info(f'    Status: {code}' + (f' - {message}' if message else ''))
        
        logger.info('=' * 80)
        logger.info('Raw JSON (first 500 chars):')
        logger.info(json.dumps(data, indent=2)[:500])
        logger.info('=' * 80)

    def _format_value(self, value: dict) -> str:
        """Format an attribute value for display."""
        if 'stringValue' in value:
            return value['stringValue']
        elif 'intValue' in value:
            return str(value['intValue'])
        elif 'doubleValue' in value:
            return str(value['doubleValue'])
        elif 'boolValue' in value:
            return str(value['boolValue'])
        elif 'arrayValue' in value:
            return f"[{', '.join(str(self._format_value(v)) for v in value['arrayValue'].get('values', []))}]"
        else:
            return str(value)

    def _save_traces_to_file(self, data: dict) -> None:
        """Save trace data to a timestamped JSON file."""
        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            
            timestamp = datetime.now().strftime('%Y-%m-%d_%H:%M:%S')
            filename = LOG_DIR / f'{timestamp}.json'
            
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            
            logger.info(f'Saved trace data to {filename}')
        except Exception as e:
            logger.error(f'Failed to save trace data to file: {e}', exc_info=True)

    def log_message(self, format, *args):
        """Override to use our logger instead of stderr."""
        logger.debug(f'{self.address_string()} - {format % args}')
    
    def log_request(self, code='-', size='-'):
        """Override to reduce default request logging."""
        pass


def run_server(port: int = DEFAULT_PORT) -> None:
    """Run the OTLP test server."""
    server_address = (BIND_ADDRESS, port)
    
    # Test if port is already in use
    import socket
    test_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    test_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        test_socket.bind(server_address)
        test_socket.listen(1)
        test_socket.close()
    except OSError as e:
        logger.error(f'Port {port} is already in use: {e}')
        logger.error('Please stop the existing server or use a different port with --port')
        return
    
    httpd = HTTPServer(server_address, OTLPHandler)
    httpd.allow_reuse_address = True
    
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    
    logger.info(f'OTLP test server starting...')
    logger.info(f'Listening on http://{BIND_ADDRESS}:{port}')
    logger.info(f'OTLP traces endpoint: http://localhost:{port}/v1/traces')
    logger.info(f'Health check: http://localhost:{port}/health')
    logger.info(f'Trace logs directory: {LOG_DIR}')
    logger.info('Press Ctrl+C to stop the server')
    logger.info('=' * 80)
    logger.info('Waiting for connections...')
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info('\nShutting down server...')
        httpd.shutdown()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='OTLP test server that logs received traces'
    )
    parser.add_argument(
        '--port',
        type=int,
        default=DEFAULT_PORT,
        help=f'Port to listen on (default: {DEFAULT_PORT})'
    )
    args = parser.parse_args()
    
    run_server(args.port)
