const fs = require('fs');
const path = require('path');

const CONFIG_ID = "custom_md_folder";

// 辅助：递归遍历 (搜索用)
const walkDir = (dir, callback) => {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  files.forEach(f => {
    const dirPath = path.join(dir, f);
    try {
        const stat = fs.statSync(dirPath);
        if (stat.isDirectory()) {
          if (f.startsWith('.') || f === 'node_modules' || f === 'assets') return; 
          walkDir(dirPath, callback);
        } else {
          callback(dirPath);
        }
    } catch(e) {}
  });
};

window.services = {
  // --- 基础路径操作 ---
  getRootFolder: () => {
    const doc = utools.db.get(CONFIG_ID);
    return doc ? doc.data : null;
  },
  
  saveRootFolder: (dirPath) => {
    const doc = utools.db.get(CONFIG_ID);
    utools.db.put({ _id: CONFIG_ID, data: dirPath, _rev: doc?._rev });
  },

  selectDirectory: () => {
    const paths = utools.showOpenDialog({ title: '选择笔记库', properties: ['openDirectory'] });
    return paths ? paths[0] : null;
  },

  // 关键修复：使用 path.dirname 获取父级，杜绝字符串拼接 Bug
  getParentDir: (currentPath) => {
    return path.dirname(currentPath);
  },

  // --- 文件系统操作 ---
  listFilesAndFolders: (dirPath) => {
    if (!dirPath || !fs.existsSync(dirPath)) return [];
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      return items
        .map(item => ({
          name: item.name,
          path: path.join(dirPath, item.name),
          isDirectory: item.isDirectory(),
          // 隐藏 assets 和 . 开头的文件
          isVisible: (item.isDirectory() && item.name !== 'assets' && !item.name.startsWith('.')) || item.name.endsWith('.md')
        }))
        .filter(i => i.isVisible)
        .sort((a, b) => (a.isDirectory === b.isDirectory ? 0 : a.isDirectory ? -1 : 1));
    } catch (e) { return []; }
  },

  searchFiles: (rootDir, keyword) => {
    if (!rootDir || !keyword.trim()) return [];
    const results = [];
    const lowerKey = keyword.toLowerCase();
    walkDir(rootDir, (filePath) => {
      if (filePath.endsWith('.md')) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const fileName = path.basename(filePath);
          if (fileName.toLowerCase().includes(lowerKey) || content.toLowerCase().includes(lowerKey)) {
             results.push({
               name: fileName,
               path: filePath,
               isDirectory: false,
               matchContext: content.toLowerCase().includes(lowerKey)
             });
          }
        } catch(e) {}
      }
    });
    return results;
  },

  // 高级搜索：支持正则、大小写、整词匹配
  searchFilesAdvanced: (rootDir, keyword, options) => {
    if (!rootDir || !keyword.trim()) return [];
    
    const results = [];
    let regex;
    
    try {
      // 构建正则表达式
      let pattern = keyword;
      
      // 如果不是正则模式，转义特殊字符
      if (!options.useRegex) {
        pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      
      // 整词匹配
      if (options.wholeWord && !options.useRegex) {
        pattern = `\\b${pattern}\\b`;
      }
      
      const flags = options.matchCase ? 'g' : 'gi';
      regex = new RegExp(pattern, flags);
    } catch (e) {
      // 正则表达式错误，返回空结果
      return [];
    }
    
    walkDir(rootDir, (filePath) => {
      if (filePath.endsWith('.md')) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const fileName = path.basename(filePath);
          
          // 检查文件名和内容是否匹配
          const nameMatches = regex.test(fileName);
          regex.lastIndex = 0; // 重置正则
          const contentMatches = regex.test(content);
          regex.lastIndex = 0; // 重置正则
          
          if (nameMatches || contentMatches) {
            // 计算匹配数量
            const nameMatchCount = (fileName.match(regex) || []).length;
            regex.lastIndex = 0;
            const contentMatchCount = (content.match(regex) || []).length;
            regex.lastIndex = 0;
            const totalMatches = nameMatchCount + contentMatchCount;
            
            results.push({
              name: fileName,
              path: filePath,
              isDirectory: false,
              matchContext: contentMatches,
              matchCount: totalMatches
            });
          }
        } catch(e) {}
      }
    });
    
    return results;
  },

  readFile: (p) => fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : "",
  
  saveFile: (p, c) => fs.writeFileSync(p, c, 'utf-8'),

  createFile: (folder, name) => {
    if (!name.endsWith('.md')) name += '.md';
    const full = path.join(folder, name);
    if (!fs.existsSync(full)) { fs.writeFileSync(full, "# " + name.replace('.md',''), 'utf-8'); return full; }
    return null;
  },

  createFolder: (folder, name) => {
    const full = path.join(folder, name);
    if (!fs.existsSync(full)) { fs.mkdirSync(full); return true; }
    return false;
  },

  deleteItem: (p) => {
     if(fs.existsSync(p)){
         const stat = fs.statSync(p);
         if(stat.isDirectory()){
             try { fs.rmdirSync(p); return true; } catch(e) { return false; }
         } else {
             fs.unlinkSync(p); return true;
         }
     }
     return false;
  },

  // 新增：移动文件 (用于拖拽)
  moveItem: (oldPath, newFolderPath) => {
    const fileName = path.basename(oldPath);
    const newPath = path.join(newFolderPath, fileName);
    if (oldPath === newPath) return false;
    if (fs.existsSync(newPath)) return false; // 防止覆盖
    try {
      fs.renameSync(oldPath, newPath);
      return true;
    } catch(e) { return false; }
  },

  // 新增：重命名文件或文件夹
  renameItem: (oldPath, newName) => {
    if (!fs.existsSync(oldPath)) return false;
    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, newName);
    if (oldPath === newPath) return false; // 名称未改变
    if (fs.existsSync(newPath)) return false; // 新名称已存在
    try {
      fs.renameSync(oldPath, newPath);
      return newPath;
    } catch(e) { return false; }
  },
  
  // 新增：系统级右键菜单辅助
  showContextMenu: (type) => {
    // 这是一个钩子，实际逻辑在前端，这里只做占位或传递原生能力
  }
}