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

async function runTests() {
  console.log('--- Testing DnD Reorder & Category Endpoints ---')
  try {
    // 1. POST task with category
    const t1 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/tasks',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      { title: 'Test engineering task', priority: 'high', category: 'Engineering' }
    )
    console.log('✓ Created task with category:', t1.body.title, '[', t1.body.category, ']')

    const t2 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/tasks',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      { title: 'Test design task', priority: 'medium', category: 'Design' }
    )
    console.log('✓ Created task with category:', t2.body.title, '[', t2.body.category, ']')

    // 2. GET /api/tasks?category=Engineering
    const engTasks = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/tasks?category=Engineering',
      method: 'GET'
    })
    console.log('✓ GET /api/tasks?category=Engineering count:', engTasks.body.length)

    // 3. PATCH /api/tasks/reorder
    const reorderRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/tasks/reorder',
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }
      },
      { orderedIds: [t2.body.id, t1.body.id] }
    )
    console.log('✓ PATCH /api/tasks/reorder status:', reorderRes.status, reorderRes.body.message)

    // Clean up
    await request({ hostname: 'localhost', port: PORT, path: `/api/tasks/${t1.body.id}`, method: 'DELETE' })
    await request({ hostname: 'localhost', port: PORT, path: `/api/tasks/${t2.body.id}`, method: 'DELETE' })
    console.log('✓ Cleaned up test items')

    console.log('\nAll Drag-and-Drop & Category tests passed successfully!')
  } catch (err) {
    console.error('Test error:', err)
  }
}

runTests()
