#!/bin/bash
set -e

echo "=== bboyong Web Smoke Test ==="
echo ""

# 포트 번호 감지 (로그에서 읽기)
PORT=$(grep "Local:" /tmp/web-dev.log 2>/dev/null | sed 's/.*:\([0-9]*\).*/\1/' | tail -1)
if [ -z "$PORT" ]; then
  echo "✗ Dev server not running. Start with: cd packages/web && pnpm dev > /tmp/web-dev.log 2>&1 &"
  exit 1
fi

echo "Detected port: $PORT"
BASE_URL="http://localhost:$PORT"
echo ""

# Test 1: Login page loads
echo "✓ Test 1: Login page..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/login")
if [ "$RESPONSE" == "200" ]; then
  echo "  Status: $RESPONSE"
else
  echo "  FAILED: Expected 200, got $RESPONSE"
  exit 1
fi

# Test 2: Signup page loads
echo "✓ Test 2: Signup page..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/signup")
if [ "$RESPONSE" == "200" ]; then
  echo "  Status: $RESPONSE"
else
  echo "  FAILED: Expected 200, got $RESPONSE"
  exit 1
fi

# Test 3: Static CSS loads
echo "✓ Test 3: Static assets..."
CSS=$(curl -s "$BASE_URL/_next/static/css/app/layout.css" 2>/dev/null | wc -c)
if [ "$CSS" -gt 100 ]; then
  echo "  CSS size: $CSS bytes"
else
  echo "  FAILED: CSS too small or missing"
  exit 1
fi

# Test 4: Login page contains bboyong text
echo "✓ Test 4: Page renders..."
if curl -s "$BASE_URL/login" | grep -q "bboyong"; then
  echo "  Content verified"
else
  echo "  FAILED: bboyong text not found"
  exit 1
fi

echo ""
echo "All smoke tests passed! 🎉"
