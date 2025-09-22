'use client'

import { useState, useEffect } from 'react'

// 웹용 렌더러
class WebRenderer {
  private messageCallback?: (message: any, character?: any) => void

  setMessageCallback(callback: (message: any, character?: any) => void) {
    this.messageCallback = callback
  }

  async initialize() {
    console.log('🎭 WebRenderer initialized')
  }

  async render(message: any, character?: any) {
    // 콘솔 출력 (ConsoleRenderer와 동일한 로직)
    const timestamp = message.timestamp.toLocaleTimeString()

    if (message.type === 'user') {
      console.log(`👤 [${timestamp}] User: ${message.content}`)
    } else if (message.type === 'character' && character) {
      console.log(`🎭 [${timestamp}] ${character.name}: ${message.content}`)
    } else {
      console.log(`ℹ️ [${timestamp}] System: ${message.content}`)
    }

    // 웹 UI 업데이트
    if (this.messageCallback) {
      this.messageCallback(message, character)
    }
  }

  async destroy() {
    console.log('🎭 WebRenderer destroyed')
  }
}

export default function Home() {
  const [charivo, setCharivo] = useState<any | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const initCharivo = async () => {
      console.log('🚀 Starting Charivo initialization...')

      // Dynamic imports
      const { Charivo } = await import('@charivo/core')
      const { StubLLMAdapter } = await import('@charivo/adapter-llm-stub')

      const instance = new Charivo()
      const renderer = new WebRenderer()
      const llmAdapter = new StubLLMAdapter()

      console.log('📦 Created instances:', { instance, renderer, llmAdapter })

      // 메시지 콜백 설정
      renderer.setMessageCallback((message, character) => {
        console.log('📨 Message callback triggered:', message, character)
        setMessages(prev => [...prev, { ...message, character }])
      })

      await renderer.initialize()
      instance.attachRenderer(renderer)
      instance.attachLLM(llmAdapter)

      // 캐릭터 추가
      const character = {
        id: 'miko',
        name: '미코',
        description: '귀여운 AI 어시스턴트',
        personality: '친근하고 도움이 되는 성격'
      }
      instance.addCharacter(character)

      // 이벤트 리스너
      instance.on('character:speak', ({ character, message }) => {
        console.log(`🎵 ${character.name}: "${message}"`)
      })

      console.log('✅ Charivo initialization complete')
      setCharivo(instance)
    }

    initCharivo().catch(console.error)
  }, [])

  const handleSend = async () => {
    if (!charivo || !input.trim()) return

    setIsLoading(true)
    try {
      await charivo.userSay(input, 'miko')
      setInput('')
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-800 dark:text-white mb-2">
              🎭 Charivo Demo
            </h1>
            <p className="text-gray-600 dark:text-gray-300">
              미코와 대화해보세요!
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            <div className="h-96 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 && (
                <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                  대화를 시작해보세요! 👋
                </div>
              )}

              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${
                    msg.type === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      msg.type === 'user'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white'
                    }`}
                  >
                    {msg.type !== 'user' && msg.character && (
                      <div className="text-xs font-semibold mb-1 text-purple-600 dark:text-purple-400">
                        {msg.character.name}
                      </div>
                    )}
                    <div className="text-sm">{msg.content}</div>
                    <div className="text-xs opacity-70 mt-1">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 dark:bg-gray-700 rounded-lg px-4 py-2">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t dark:border-gray-700 p-4">
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="메시지를 입력하세요..."
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  disabled={isLoading}
                />
                <button
                  onClick={handleSend}
                  disabled={isLoading || !input.trim()}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  전송
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
