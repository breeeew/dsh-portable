import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

test('client bundle registers the portable settings section', () => {
  const loaded = []
  const sandbox = {
    window: { __ModuleLoader__: { load: (module) => loaded.push(module) } },
    console,
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })

  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'dsh-portable')

  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useRef: () => ({ current: true }),
  }

  const instance = loaded[0].factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })

  assert.equal(typeof instance.apply, 'function')
  assert.deepEqual([...instance.inject], ['slots', 'locale'])

  const registered = []
  const ctx = {
    locale: { register: () => {}, bind: () => (key) => key },
    effect: (fn) => fn(),
    slots: {
      inject: (_name, fn) => fn(),
      register: (options, component) => {
        registered.push({ options, component })
        return () => {}
      },
    },
  }

  instance.apply(ctx)

  assert.equal(registered.length, 1)
  assert.equal(registered[0].options.name, 'settings.section')
  assert.equal(registered[0].options.id, 'portable')
  assert.equal(registered[0].options.locale, 'portable')
  assert.equal(typeof registered[0].options.label, 'function')

  const element = registered[0].component({ t: (key) => key })
  assert.equal(element.type, 'div')
  assert.equal(element.props.className, 'dshp-root')
})
