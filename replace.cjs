const fs = require('fs');
const path = require('path');

const iconMap = {
  Search: 'search',
  Plus: 'add',
  Trash2: 'delete',
  Edit: 'edit',
  Tag: 'sell',
  X: 'close',
  XCircle: 'close',
  Upload: 'upload',
  Download: 'download',
  Receipt: 'receipt_long',
  Printer: 'print',
  Loader2: 'progress_activity',
  AlertTriangle: 'warning',
  History: 'history',
  Lock: 'lock',
  Mail: 'mail',
  Eye: 'visibility',
  EyeOff: 'visibility_off',
  GraduationCap: 'school',
  Clock: 'schedule',
  Percent: 'percent',
  BadgeDollarSign: 'monetization_on',
  ShieldAlert: 'gpp_maybe',
  Settings: 'settings',
  IndianRupee: 'currency_rupee',
  Users: 'group',
  TrendingUp: 'trending_up',
  AlertCircle: 'error'
};

const pagesDir = path.join(__dirname, 'src', 'pages');

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  // Replace Lucide imports
  content = content.replace(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"];?/g, '');

  // Replace icon components
  for (const [lucide, material] of Object.entries(iconMap)) {
    const regex = new RegExp(`<${lucide}\\b([^>]*)/>`, 'g');
    content = content.replace(regex, (match, props) => {
      let className = 'material-symbols-outlined text-[18px]';
      if (props.includes('animate-spin')) {
        className += ' animate-spin';
      }
      return `<span className="${className}">${material}</span>`;
    });
  }

  // Update page headers
  content = content.replace(
    /className="text-2xl font-bold tracking-tight text-slate-900"/g,
    'className="text-4xl font-headline font-bold tracking-tight text-primary"'
  );
  content = content.replace(
    /className="text-3xl font-bold tracking-tight text-slate-900"/g,
    'className="text-4xl font-headline font-bold tracking-tight text-primary"'
  );

  // General text updates
  content = content.replace(
    /text-slate-500/g,
    'text-primary/70 font-body'
  );
  content = content.replace(
    /text-slate-900/g,
    'text-primary'
  );
  content = content.replace(
    /text-slate-700/g,
    'text-primary/90'
  );

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${path.basename(filePath)}`);
  }
}

fs.readdirSync(pagesDir).forEach(file => {
  if (file.endsWith('.tsx')) {
    processFile(path.join(pagesDir, file));
  }
});
