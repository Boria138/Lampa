const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('require', (module) => {
    if (module === 'fs') {
        return {
            existsSync: (path) => {
                return ipcRenderer.sendSync('fs-existsSync', path);
            }
        };
    }
    if (module === 'child_process') {
        return {
            spawn: (command, args, options) => {
                const id = Math.random().toString(36).substr(2, 9);
                const stdoutChannel = `child-process-spawn-stdout-${id}`;
                const stderrChannel = `child-process-spawn-stderr-${id}`;
                const errorChannel = `child-process-spawn-error-${id}`;
                const exitChannel = `child-process-spawn-exit-${id}`;
                const errorListeners = [];
                const exitListeners = [];
                const stdoutListeners = [];
                const stderrListeners = [];
                let isCleaned = false;

                const handleStdout = (_event, data) => {
                    stdoutListeners.forEach((listener) => listener(data));
                };
                const handleStderr = (_event, data) => {
                    stderrListeners.forEach((listener) => listener(data));
                };
                const cleanup = () => {
                    if (isCleaned) return;
                    isCleaned = true;
                    ipcRenderer.removeListener(stdoutChannel, handleStdout);
                    ipcRenderer.removeListener(stderrChannel, handleStderr);
                };

                ipcRenderer.on(stdoutChannel, handleStdout);
                ipcRenderer.on(stderrChannel, handleStderr);
                ipcRenderer.once(errorChannel, (_event, error) => {
                    cleanup();
                    errorListeners.forEach((listener) => listener(error));
                });
                ipcRenderer.once(exitChannel, (_event, code) => {
                    cleanup();
                    exitListeners.forEach((listener) => listener(code));
                });

                ipcRenderer.send('child-process-spawn', id, command, args, options);
                return {
                    on: (event, callback) => {
                        if (event === 'error') {
                            errorListeners.push(callback);
                        } else if (event === 'exit') {
                            exitListeners.push(callback);
                        }
                    },
                    stdout: {
                        on: (event, callback) => {
                            if (event === 'data') {
                                stdoutListeners.push(callback);
                            }
                        }
                    },
                    stderr: {
                        on: (event, callback) => {
                            if (event === 'data') {
                                stderrListeners.push(callback);
                            }
                        }
                    }
                };
            }
        };
    }
    return undefined;
});

contextBridge.exposeInMainWorld('electronAPI', {
    submitUrl: (url) => ipcRenderer.send('submit-url', url),
                                cancelUrl: () => ipcRenderer.send('cancel-url')
});
