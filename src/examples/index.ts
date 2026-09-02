/** Curated "aha" snippets for the gallery — each exercises a teaching moment. */
export interface Example {
  id: string
  title: string
  description: string
  code: string
  /** 'basic' = beginner fundamentals; 'advanced' = event loop, closures, async. */
  category: 'basic' | 'advanced'
}

/** Beginner fundamentals — sync JS, no event loop or async. */
const BASIC_EXAMPLES: Example[] = [
  {
    id: 'variables-and-logging',
    title: 'Variables & console.log',
    description: 'Declare values with let/const and print them.',
    category: 'basic',
    code: `const name = 'Ada'
let age = 36
age = age + 1
console.log('name:', name)
console.log('age:', age)
`,
  },
  {
    id: 'functions-basics',
    title: 'Functions & return',
    description: 'Define a function, pass arguments, use its return value.',
    category: 'basic',
    code: `function add(a, b) {
  return a + b
}

const sum = add(2, 3)
console.log('2 + 3 =', sum)
console.log('doubled:', add(sum, sum))
`,
  },
  {
    id: 'conditionals',
    title: 'if / else',
    description: 'Branch on a condition to choose what runs.',
    category: 'basic',
    code: `function classify(n) {
  if (n > 0) {
    return 'positive'
  } else if (n < 0) {
    return 'negative'
  } else {
    return 'zero'
  }
}

console.log(classify(5))
console.log(classify(-2))
console.log(classify(0))
`,
  },
  {
    id: 'arrays-and-loops',
    title: 'Arrays & loops',
    description: 'Walk an array with a for loop and accumulate a result.',
    category: 'basic',
    code: `const nums = [10, 20, 30, 40]
let total = 0

for (let i = 0; i < nums.length; i++) {
  total = total + nums[i]
}

console.log('sum:', total)
console.log('count:', nums.length)
`,
  },
  {
    id: 'objects-basics',
    title: 'Objects & properties',
    description: 'Store related data on an object and read/update its fields.',
    category: 'basic',
    code: `const user = {
  name: 'Sam',
  score: 0,
}

user.score = user.score + 10
console.log(user.name, 'has', user.score, 'points')
`,
  },
]

/** Deeper "aha" moments — event loop, closures, promises, async/await. */
const ADVANCED_EXAMPLES: Example[] = [
  {
    id: 'event-loop-order',
    title: 'Event loop ordering',
    description: 'Why does this log A, D, C, B? Microtasks drain before the timer.',
    category: 'advanced',
    code: `console.log('A')

setTimeout(() => {
  console.log('B')
}, 0)

Promise.resolve().then(() => {
  console.log('C')
})

console.log('D')
`,
  },
  {
    id: 'closure-in-loop',
    title: 'Closures in a loop (let vs var)',
    description: 'let gives each iteration its own binding; var shares one.',
    category: 'advanced',
    code: `const withLet = []
for (let i = 0; i < 3; i++) {
  withLet.push(function () { return i })
}
console.log('let:', withLet[0](), withLet[1](), withLet[2]())

var withVar = []
for (var j = 0; j < 3; j++) {
  withVar.push(function () { return j })
}
console.log('var:', withVar[0](), withVar[1](), withVar[2]())
`,
  },
  {
    id: 'recursion',
    title: 'Recursion & the call stack',
    description: 'Watch the call stack grow and unwind through factorial.',
    category: 'advanced',
    code: `function factorial(n) {
  if (n <= 1) return 1
  return n * factorial(n - 1)
}

console.log(factorial(5))
`,
  },
  {
    id: 'closure-counter',
    title: 'Closure factory',
    description: 'Each counter keeps its own captured variable — see it in the graph.',
    category: 'advanced',
    code: `function makeCounter() {
  let count = 0
  return function () {
    count = count + 1
    return count
  }
}

const inc = makeCounter()
console.log(inc(), inc(), inc())
`,
  },
  {
    id: 'promise-chain',
    title: 'Promise chain',
    description: 'Each .then schedules a microtask with the previous result.',
    category: 'advanced',
    code: `Promise.resolve(2)
  .then((x) => x * 3)
  .then((x) => x + 1)
  .then((x) => console.log('result:', x))

console.log('sync first')
`,
  },
  {
    id: 'async-await',
    title: 'async / await',
    description: 'await suspends the function; it resumes as a microtask.',
    category: 'advanced',
    code: `function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  console.log('1: start')
  await delay(0)
  console.log('3: after await')
}

main()
console.log('2: sync continues')
`,
  },
  {
    id: 'debounce',
    title: 'Debounce with setTimeout',
    description: 'clearTimeout cancels the pending timer on each rapid call.',
    category: 'advanced',
    code: `function debounce(fn, ms) {
  let timer
  return function (value) {
    clearTimeout(timer)
    timer = setTimeout(function () { fn(value) }, ms)
  }
}

const log = debounce(function (v) { console.log('fired:', v) }, 100)
log('a')
log('b')
log('c')
`,
  },
  {
    id: 'object-graph',
    title: 'Object references',
    description: 'Two objects pointing at the same child — see shared references.',
    category: 'advanced',
    code: `const child = { value: 1 }
const a = { name: 'a', child: child }
const b = { name: 'b', child: child }

child.value = 42
console.log(a.child.value, b.child.value)
`,
  },
]

/** Basics first, then advanced — the flat list used by the palette and gallery. */
export const EXAMPLES: Example[] = [...BASIC_EXAMPLES, ...ADVANCED_EXAMPLES]
