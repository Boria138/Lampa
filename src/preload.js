const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('require', (module) => {
    if (module === 'fs') {
        return {
            readFile: (path, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                ipcRenderer.send('fs-readFile', path, options);
                ipcRenderer.once(`fs-readFile-response-${path}`, (event, error, data) => {
                    callback(error, data);
                });
            },
            writeFile: (path, data, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                ipcRenderer.send('fs-writeFile', path, data, options);
                ipcRenderer.once(`fs-writeFile-response-${path}`, (event, error) => {
                    callback(error);
                });
            },
            existsSync: (path) => {
                return ipcRenderer.sendSync('fs-existsSync', path);
            }
        };
    }
    if (module === 'child_process') {
        return {
            spawn: (command, args, options) => {
                const id = Math.random().toString(36).substr(2, 9);
                ipcRenderer.send('child-process-spawn', id, command, args, options);
                return {
                    on: (event, callback) => {
                        if (event === 'error') {
                            ipcRenderer.once(`child-process-spawn-error-${id}`, (event, error) => callback(error));
                        } else if (event === 'exit') {
                            ipcRenderer.once(`child-process-spawn-exit-${id}`, (event, code) => callback(code));
                        }
                    },
                    stdout: {
                        on: (event, callback) => {
                            if (event === 'data') {
                                ipcRenderer.on(`child-process-spawn-stdout-${id}`, (event, data) => callback(data));
                            }
                        }
                    },
                    stderr: {
                        on: (event, callback) => {
                            if (event === 'data') {
                                ipcRenderer.on(`child-process-spawn-stderr-${id}`, (event, data) => callback(data));
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
