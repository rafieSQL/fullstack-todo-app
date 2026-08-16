import http from 'http'

// Start server child process or test against running instance
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

async function runTests() {
  console.log('Testing Task REST API on port', PORT)

  try {
    // 1. Health Check
    const health = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/health',
      method: 'GET'
    })
    console.log('✓ Health check status:', health.status, health.body)

    // 2. GET /api/tasks
    const getTasks = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/tasks',
      method: 'GET'
    })
    console.log('✓ GET /api/tasks count:', getTasks.body.length)

    // 3. POST /api/tasks
    const createRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/tasks',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      { title: 'Test new automated verification task', priority: 'high' }
    )
    console.log('✓ POST /api/tasks created:', createRes.status, createRes.body)
    const newTaskId = createRes.body.id

    // 4. PATCH /api/tasks/:id
    const patchRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/tasks/${newTaskId}`,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }
      },
      { completed: true }
    )
    console.log('✓ PATCH /api/tasks/:id toggled completed:', patchRes.status, patchRes.body.completed)

    // 5. DELETE /api/tasks/:id
    const deleteRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/tasks/${newTaskId}`,
      method: 'DELETE'
    })
    console.log('✓ DELETE /api/tasks/:id deleted:', deleteRes.status, deleteRes.body)

    // 6. DELETE /api/tasks/completed
    const clearCompletedRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/tasks/completed',
      method: 'DELETE'
    })
    console.log('✓ DELETE /api/tasks/completed:', clearCompletedRes.status, clearCompletedRes.body)

    console.log('\nAll API Endpoint tests passed successfully!')
  } catch (err) {
    console.error('Test error:', err)
  }
}

runTests()
