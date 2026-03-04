const fs = require('fs');
const path = require('path');

const services = [
  { key: 'ShadowQ', url: 'https://www.shadowq.com' },
  { key: 'Mojoo', url: 'https://mojoo.org' },
  { key: 'Google', url: 'https://www.google.com' }
];

const TOTAL_DAYS = 60;
const ENTRIES_PER_HOUR = 5;
const TOTAL_FAILURE_DAYS = 5;
const TOTAL_PARTIAL_DAYS = 10;

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function generateLogEntry(date, status, serviceKey) {
  let latency = null;
  
  if (status === 'success') {
    if (serviceKey === 'Google') {
      latency = Math.floor(Math.random() * 80) + 20;
    } else if (serviceKey === 'ShadowQ') {
      latency = Math.floor(Math.random() * 200) + 50;
    } else {
      latency = Math.floor(Math.random() * 150) + 30;
    }
  }
  
  return {
    time: formatDate(date),
    status: status,
    latency: latency
  };
}

function generateLogsForService(service) {
  const logs = [];
  const endDate = new Date(2026, 2, 4);
  endDate.setHours(23, 59, 59, 999);
  
  const failureDays = new Set();
  const partialDays = new Set();
  
  while (failureDays.size < TOTAL_FAILURE_DAYS) {
    const randomDay = Math.floor(Math.random() * TOTAL_DAYS);
    if (!failureDays.has(randomDay)) {
      failureDays.add(randomDay);
    }
  }
  
  while (partialDays.size < TOTAL_PARTIAL_DAYS) {
    const randomDay = Math.floor(Math.random() * TOTAL_DAYS);
    if (!failureDays.has(randomDay) && !partialDays.has(randomDay)) {
      partialDays.add(randomDay);
    }
  }
  
  console.log(`  Failure days (0-indexed from Jan 4): [${Array.from(failureDays).sort((a,b) => a-b).join(', ')}]`);
  console.log(`  Partial days (0-indexed from Jan 4): [${Array.from(partialDays).sort((a,b) => a-b).join(', ')}]`);
  
  for (let dayIndex = 0; dayIndex < TOTAL_DAYS; dayIndex++) {
    const dayDate = new Date(2026, 0, 4);
    dayDate.setDate(dayDate.getDate() + dayIndex);
    
    let dayStatus;
    if (failureDays.has(dayIndex)) {
      dayStatus = 'failure';
    } else if (partialDays.has(dayIndex)) {
      dayStatus = 'partial';
    } else {
      dayStatus = 'success';
    }
    
    for (let hour = 0; hour < 24; hour++) {
      for (let entryIndex = 0; entryIndex < ENTRIES_PER_HOUR; entryIndex++) {
        const entryDate = new Date(dayDate);
        entryDate.setHours(hour, 0, 0, 0);
        
        const randomMinutes = Math.floor(Math.random() * 60);
        const randomSeconds = Math.floor(Math.random() * 60);
        entryDate.setMinutes(randomMinutes);
        entryDate.setSeconds(randomSeconds);
        
        let entryStatus;
        if (dayStatus === 'failure') {
          entryStatus = 'failure';
        } else if (dayStatus === 'partial') {
          entryStatus = Math.random() < 0.3 ? 'failure' : 'success';
        } else {
          entryStatus = 'success';
        }
        
        const entry = generateLogEntry(entryDate, entryStatus, service.key);
        logs.push(JSON.stringify(entry));
      }
    }
  }
  
  logs.sort((a, b) => {
    const timeA = JSON.parse(a).time;
    const timeB = JSON.parse(b).time;
    return timeA.localeCompare(timeB);
  });
  
  return logs.join('\n');
}

function main() {
  const logsDir = path.join(__dirname, 'logs');
  
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  for (const service of services) {
    console.log(`Generating logs for ${service.key}...`);
    const logs = generateLogsForService(service);
    const filePath = path.join(logsDir, `${service.key}_report.log`);
    fs.writeFileSync(filePath, logs);
    const lineCount = logs.split('\n').length;
    console.log(`  Generated ${lineCount} entries for ${service.key}`);
  }
  
  console.log('\nDone!');
  console.log('Summary:');
  console.log(`  - Date range: 2026-01-04 to 2026-03-04`);
  console.log(`  - Total days: ${TOTAL_DAYS}`);
  console.log(`  - Entries per hour: ${ENTRIES_PER_HOUR}`);
  console.log(`  - Entries per day: ${24 * ENTRIES_PER_HOUR}`);
  console.log(`  - Total entries per service: ${TOTAL_DAYS * 24 * ENTRIES_PER_HOUR}`);
  console.log(`  - Full failure days: ${TOTAL_FAILURE_DAYS}`);
  console.log(`  - Partial failure days: ${TOTAL_PARTIAL_DAYS}`);
  console.log(`  - Normal days: ${TOTAL_DAYS - TOTAL_FAILURE_DAYS - TOTAL_PARTIAL_DAYS}`);
}

main();
