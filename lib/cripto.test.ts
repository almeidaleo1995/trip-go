// Testes da criptografia de campo.
//
// O que se trava aqui: a ida e volta, a tolerância ao que já está gravado em
// texto puro (sem ela, ligar a chave apagaria o CPF de todo mundo da tela) e o
// fato de que texto adulterado NÃO volta como dado bom.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  CAMPOS_CIFRADOS,
  _resetChave,
  cifrar,
  cifrarPerfil,
  decifrar,
  decifrarPerfil,
  estaCifrado,
} from './cripto.ts'

function comChave(hex: string | null, fn: () => void) {
  const antes = process.env.DADOS_SECRET
  if (hex === null) delete process.env.DADOS_SECRET
  else process.env.DADOS_SECRET = hex
  _resetChave()
  try {
    fn()
  } finally {
    if (antes === undefined) delete process.env.DADOS_SECRET
    else process.env.DADOS_SECRET = antes
    _resetChave()
  }
}

const CHAVE = randomBytes(32).toString('hex')

test('ida e volta devolve o mesmo texto', () => {
  comChave(CHAVE, () => {
    const cpf = '12345678901'
    const cifrado = cifrar(cpf)!
    assert.notEqual(cifrado, cpf)
    assert.ok(estaCifrado(cifrado))
    assert.equal(decifrar(cifrado), cpf)
  })
})

test('o mesmo valor cifra diferente a cada vez', () => {
  comChave(CHAVE, () => {
    // IV aleatório por gravação. Sem isso, dois participantes com o mesmo
    // documento teriam a mesma linha, e um dump revelaria a igualdade.
    assert.notEqual(cifrar('12345678901'), cifrar('12345678901'))
  })
})

test('vazio e nulo viram NULL, nao texto cifrado', () => {
  comChave(CHAVE, () => {
    // `documentacaoDaViagem` decide o que falta por "a coluna está preenchida?".
    // Cifrar a string vazia faria "não informado" parecer informado.
    assert.equal(cifrar(''), null)
    assert.equal(cifrar(null), null)
    assert.equal(cifrar(undefined), null)
  })
})

test('cifrar duas vezes nao empilha camada', () => {
  comChave(CHAVE, () => {
    const uma = cifrar('AB123456')!
    assert.equal(cifrar(uma), uma)
  })
})

test('texto puro gravado antes da chave continua legivel', () => {
  comChave(CHAVE, () => {
    // A linha que já estava no banco quando a criptografia foi ligada. Sem esta
    // tolerância, ligar a chave esvaziaria a tela de perfil de quem já cadastrou.
    assert.equal(decifrar('12345678901'), '12345678901')
  })
})

test('sem DADOS_SECRET o app grava e le em texto puro', () => {
  comChave(null, () => {
    assert.equal(cifrar('12345678901'), '12345678901')
    assert.equal(decifrar('12345678901'), '12345678901')
  })
})

test('texto cifrado sem chave devolve null, nao lixo', () => {
  comChave(null, () => {
    assert.equal(decifrar('enc.v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.CCCC'), null)
  })
})

test('adulterar o texto cifrado nao devolve dado', () => {
  comChave(CHAVE, () => {
    const cifrado = cifrar('12345678901')!
    // Troca um caractere NO MEIO do corpo. O GCM autentica, então isso falha a
    // verificação em vez de devolver bytes diferentes.
    //
    // No meio, e não no fim: o último caractere de um base64url carrega bits que
    // sobram e são descartados na decodificação, então trocá-lo pode dar
    // exatamente os mesmos bytes — um teste que não testa nada.
    const meio = Math.floor(cifrado.length / 2)
    const trocado = cifrado[meio] === 'A' ? 'B' : 'A'
    assert.equal(decifrar(cifrado.slice(0, meio) + trocado + cifrado.slice(meio + 1)), null)
  })
})

test('chave errada devolve null em vez de estourar', () => {
  let cifrado = ''
  comChave(CHAVE, () => {
    cifrado = cifrar('12345678901')!
  })
  comChave(randomBytes(32).toString('hex'), () => {
    // Tela de perfil com um campo em branco é recuperável; 500 esconde o resto
    // dos dados da pessoa.
    assert.equal(decifrar(cifrado), null)
  })
})

test('uma frase tambem serve de chave', () => {
  comChave('uma frase secreta qualquer', () => {
    assert.equal(decifrar(cifrar('AB123456')), 'AB123456')
  })
})

test('o perfil cifra so as tres colunas de identidade', () => {
  comChave(CHAVE, () => {
    const perfil = {
      nome_completo: 'Ana Souza',
      cpf: '12345678901',
      rg: '112223334',
      passaporte_numero: 'AB123456',
      passaporte_pais: 'Brasil',
      emergencia_telefone: '+5511999999999',
    }
    const cifrado = cifrarPerfil(perfil)

    for (const c of CAMPOS_CIFRADOS) {
      assert.ok(estaCifrado(cifrado[c]), `${c} devia estar cifrado`)
    }
    // O que continua legível é o que precisa ser buscável ou não identifica
    // ninguém sozinho.
    assert.equal(cifrado.nome_completo, 'Ana Souza')
    assert.equal(cifrado.passaporte_pais, 'Brasil')

    assert.deepEqual(decifrarPerfil(cifrado), perfil)
  })
})

test('decifrarPerfil aceita null', () => {
  comChave(CHAVE, () => {
    assert.equal(decifrarPerfil(null), null)
  })
})

test('a lista de campos cifrados nao tem coluna de data', () => {
  // `nascimento` e `passaporte_validade` são colunas `date` no Postgres: texto
  // cifrado não entra numa delas, e um campo novo adicionado por engano à lista
  // só apareceria como erro de INSERT em produção.
  for (const c of CAMPOS_CIFRADOS) {
    assert.ok(!/nascimento|validade|emissao/.test(c))
  }
})
