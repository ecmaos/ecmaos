let bios
export default bios

export const consoleElement = document.getElementById('console')
export const stateElement = document.getElementById('bios-state')
export const versionElement = document.getElementById('bios-version')
export const commandInput = document.getElementById('command-input')
const textDecoder = new TextDecoder('utf-8')

function readStringFromWasm(ptr, length) {
    if (!ptr || length <= 0) return ''
    return textDecoder.decode(bios.HEAPU8.subarray(ptr, ptr + length))
}

function readBufferResult(ptr, lenPtr) {
    const length = bios.HEAP32[lenPtr >> 2]
    let result = ''
    if (ptr) {
        result = readStringFromWasm(ptr, length)
        bios._free(ptr)
    }
    bios._free(lenPtr)
    return result
}

export function log(message, type = 'info') {
    const timestamp = new Date().toISOString()
    const colorMap = {
        info: '#00ff00',
        error: '#ff0000',
        warning: '#ffff00'
    }
    
    consoleElement.innerHTML += `<span style="color: ${colorMap[type]}">[${timestamp}] ${message}</span>\n`
    consoleElement.scrollTop = consoleElement.scrollHeight
}

export async function initializeBIOS() {
    try {
        log('Initializing bios...')
        const module = await import('/build/dist/bios.js')
        globalThis.bios = bios = await module.default({
            name: 'bios.wasm'
        })

        const state = bios._init()
        const version = bios.ccall('get_version', 'string', [], [])

        stateElement.textContent = ['BOOTING', 'RUNNING', 'PANIC'][state]
        versionElement.textContent = version

        log('BIOS initialized successfully')
    } catch (err) {
        log(`Failed to initialize bios: ${err.message}`, 'error')
        console.error(err)
    }
}

export async function executeCommand() {
    if (!bios) {
        log('BIOS not initialized!', 'error')
        return
    }

    const command = commandInput.value
    if (!command || !command.trim()) {
        log('Empty command', 'error')
        return
    }

    try {
        log(`> ${command}`)

        const lenPtr = bios._malloc(4)
        const ptr = bios.ccall(
            'execute_with_output',
            'number',
            ['string', 'number'],
            [command.trim(), lenPtr]
        )
        const output = readBufferResult(ptr, lenPtr)
        const status = bios.ccall('get_last_status', 'number', [], [])

        if (output) log(output)
        if (!output && status !== 0) log(`Command failed with status ${status}`, 'error')
        
        commandInput.value = ''
    } catch (err) {
        log(`Command execution failed: ${err.message}`, 'error')
        console.error(err)
    }
}

export function clearConsole() {
    consoleElement.innerHTML = ''
}

commandInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        executeCommand()
    }
})

log('WASM BIOS Test Interface Ready')
log('Click "Initialize BIOS" to begin')

export async function writeFile() {
    if (!bios) return log('BIOS not initialized!', 'error')

    const path = document.getElementById('file-path').value
    const content = document.getElementById('file-content').value

    if (!path || !content) return log('Please provide both path and content', 'error')

    try {
        const result = bios.ccall('write_file', 'number', ['string', 'string'], [path, content])
        if (result === 0) log(`File written successfully: ${path}`)
        else log(`Failed to write file: ${path}`, 'error')
    } catch (err) {
        log(`File operation failed: ${err.message}`, 'error')
        console.error(err)
    }
}

export async function readFile() {
    if (!bios) return log('BIOS not initialized!', 'error')

    const path = document.getElementById('file-path').value
    if (!path) return log('Please provide a file path', 'error')

    try {
        const lenPtr = bios._malloc(4)
        const ptr = bios.ccall('read_file', 'number', ['string', 'number'], [path, lenPtr])
        const content = readBufferResult(ptr, lenPtr)
        if (content) {
            document.getElementById('file-content').value = content
            log(`File read successfully: ${path}`)
        } else log(`Failed to read file: ${path}`, 'error')
    } catch (err) {
        log(`File operation failed: ${err.message}`, 'error')
        console.error(err)
    }
}

export async function deleteFile() {
    if (!bios) return log('BIOS not initialized!', 'error')

    const path = document.getElementById('file-path').value
    if (!path) return log('Please provide a file path', 'error')

    try {
        const result = bios.ccall('delete_file', 'number', ['string'], [path])
        if (result === 0) {
            log(`File deleted successfully: ${path}`)
            document.getElementById('file-content').value = ''
        } else log(`Failed to delete file: ${path}`, 'error')
    } catch (err) {
        log(`File operation failed: ${err.message}`, 'error')
        console.error(err)
    }
}

export async function checkFileExists() {
    if (!bios) return log('BIOS not initialized!', 'error')

    const path = document.getElementById('file-path').value
    if (!path) return log('Please provide a file path', 'error')

    try {
        const exists = bios.ccall('file_exists', 'number', ['string'], [path])
        log(`File ${path} ${exists ? 'exists' : 'does not exist'}`)
    } catch (err) {
        log(`File operation failed: ${err.message}`, 'error')
        console.error(err)
    }
}

export async function listFiles() {
    if (!bios) return log('BIOS not initialized!', 'error')

    try {
        const lenPtr = bios._malloc(4)
        const ptr = bios.ccall('list_directory', 'number', ['string', 'number'], ['/', lenPtr])
        const files = readBufferResult(ptr, lenPtr)
        if (files) {
            log('Directory listing:')
            files.split('\n').forEach(file => {
                if (file) log(`  ${file}`)
            })
        } else {
            log('Failed to list directory', 'error')
        }
    } catch (err) {
        log(`File operation failed: ${err.message}`, 'error')
        console.error(err)
    }
}
