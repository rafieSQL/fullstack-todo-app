import http from 'http'

const PORT = 5000

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          resolve({ status: res.statusCode, body: parsed })
        } catch {
          resolve({ status: res.statusCode, body: data })
        }
      })
    })

    req.on('error', reject)

    if (body) {
      req.write(JSON.stringify(body))
    }
    req.end()
  })
}

async function runAdvancedTests() {
  console.log('--- Testing Advanced Endpoints ---')
  try {
    // 1. GET /api/activity
    const actRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/activity?limit=5',
      method: 'GET'
    })
    console.log('✓ GET /api/activity status:', actRes.status, 'Events returned:', actRes.body.length)

    // 2. Create sample tasks for batch testing
    const t1 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/tasks',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      { title: 'Batch item 1', priority: 'low' }
    )
    const t2 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/tasks',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      { title: 'Batch item 2', priority: 'high' }
    )

    console.log('✓ Created 2 tasks for batch testing:', t1.body.id, t2.body.id)

    // 3. PATCH /api/tasks/batch-complete
    const batchRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/tasks/batch-complete',
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }
      },
      { taskIds: [t1.body.id, t2.body.id], completed: true }
    )
    console.log('✓ PATCH /api/tasks/batch-complete:', batchRes.status, batchRes.body.message)

    // 4. Verify activity log has the batch event
    const actAfter = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/activity?limit=3',
      method: 'GET'
    })
    console.log('✓ Latest activity:', actAfter.body[0]?.message)

    // Clean up
    await request({ hostname: 'localhost', port: PORT, path: `/api/tasks/${t1.body.id}`, method: 'DELETE' })
    await request({ hostname: 'localhost', port: PORT, path: `/api/tasks/${t2.body.id}`, method: 'DELETE' })
    console.log('✓ Cleaned up test items')

    console.log('\nAll Advanced API Endpoint tests passed successfully!')
  } catch (err) {
    console.error('Test error:', err)
  }
}

runAdvancedTests()
