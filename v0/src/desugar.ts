import { BlockExpr, FunctionDecl, Program } from './ast.js'
import { IrProgram, lowerToIr } from './ir.js'

export function desugar(program: Program): IrProgram {
  const loweredBody = program.body.map(node => {
    if (node.type !== 'LetDecl') {
      return node
    }

    if (node.value.type !== 'LambdaExpr') {
      return node
    }

    const lambda = node.value
    const body: BlockExpr = {
      type: 'BlockExpr',
      body: [
        {
          type: 'ReturnExpr',
          value: lambda.body,
        },
      ],
    }

    const loweredFunction: FunctionDecl = {
      type: 'FunctionDecl',
      name: node.name,
      params: lambda.params,
      returnType: lambda.returnType ?? node.declaredType,
      body,
      isPublic: false,
    }

    return loweredFunction
  })

  return lowerToIr({
    ...program,
    body: loweredBody,
  })
}