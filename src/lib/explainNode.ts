/** Plain-English explanations of AST node types, for click-to-explain. */
const EXPLANATIONS: Record<string, string> = {
  Program: 'The whole program — the top of the syntax tree.',
  VariableDeclaration: 'Declares one or more variables (var / let / const).',
  VariableDeclarator: 'A single name = value pair in a declaration.',
  FunctionDeclaration: 'Defines a named function, hoisted to the top of its scope.',
  FunctionExpression: 'A function used as a value (e.g. assigned to a variable).',
  ArrowFunctionExpression: 'A concise function expression; does not bind its own `this`.',
  ReturnStatement: 'Returns a value from the current function.',
  IfStatement: 'Runs one branch or another based on a condition.',
  ForStatement: 'A C-style loop with init, test, and update.',
  ForOfStatement: 'Iterates over the values of an iterable (array / string).',
  WhileStatement: 'Repeats while its condition is truthy.',
  DoWhileStatement: 'Runs the body once, then repeats while the condition holds.',
  BlockStatement: 'A `{ … }` block — a new lexical scope for let/const.',
  ExpressionStatement: 'An expression evaluated for its side effects.',
  CallExpression: 'Calls a function with arguments — pushes a new stack frame.',
  NewExpression: 'Constructs a new object (here: `new Promise`).',
  MemberExpression: 'Accesses a property of an object (obj.x or obj[x]).',
  BinaryExpression: 'Combines two values with an operator (+, -, ===, …).',
  LogicalExpression: 'Short-circuiting && / || / ?? between two values.',
  AssignmentExpression: 'Assigns a value to a variable or property.',
  UpdateExpression: 'Increments or decrements (++ / --).',
  UnaryExpression: 'A one-operand operator (!, -, typeof, …).',
  ConditionalExpression: 'The ternary `cond ? a : b`.',
  Identifier: 'A name — looked up along the scope chain.',
  Literal: 'A literal value written directly in the source.',
  TemplateLiteral: 'A back-tick string with embedded ${…} expressions.',
  ArrayExpression: 'Creates a new array on the heap.',
  ObjectExpression: 'Creates a new object on the heap.',
  AwaitExpression: 'Pauses an async function until the promise settles.',
  TryStatement: 'Runs code that may throw, with catch / finally handlers.',
  ThrowStatement: 'Throws a value, unwinding to the nearest catch.',
}

export function explainNode(type: string): string {
  return EXPLANATIONS[type] ?? `A ${type} node.`
}
