#!/usr/bin/env node

/**
 * Node.js E-ink Calendar Renderer
 * Fetches Google Calendar data and renders it as a low-color PNG for e-ink displays
 * Enhanced with better private calendar support and primary calendar detection
 */

const fs = require('fs').promises;
const { createCanvas, loadImage, registerFont } = require('canvas');
const ical = require('ical');
const { DateTime } = require('luxon');
const { Command } = require('commander');
const path = require('path');
const { JWT } = require('google-auth-library');

// E-ink display colors (7-color palette)
const COLORS = {
    white: '#FFFFFF',
    black: '#000000',
    red: '#FF0000',
    green: '#00FF00',
    blue: '#0000FF',
    yellow: '#FFFF00',
    orange: '#FFA500'
};

// Default configuration
const config = {
    width: 800,
    height: 480,
    viewMode: 'week',
    outputFile: 'calendar.png',
    calendarUrls: [],
    fontPath: './DejaVuSans.ttf',
    serviceAccountPath: null,
    calendarIds: [],
    includePrimary: false,
    listCalendars: false,
    maxResults: 2500
};

/**
 * Create Google Auth JWT client from service account
 */
async function createGoogleAuthClient(serviceAccountPath) {
    try {
        const serviceAccount = JSON.parse(await fs.readFile(serviceAccountPath, 'utf8'));
        
        const jwtClient = new JWT({
            email: serviceAccount.client_email,
            key: serviceAccount.private_key,
            scopes: [
                'https://www.googleapis.com/auth/calendar.readonly',
                'https://www.googleapis.com/auth/calendar.calendars.readonly'
            ]
        });
        
        await jwtClient.authorize();
        return jwtClient;
    } catch (error) {
        throw new Error(`Failed to create Google Auth client: ${error.message}`);
    }
}

/**
 * List all accessible calendars for the authenticated user
 */
async function listGoogleCalendars(authClient) {
    try {
        const accessToken = await authClient.getAccessToken();
        
        const url = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken.token}`,
                'User-Agent': 'Node.js Calendar Renderer/1.0'
            },
            signal: AbortSignal.timeout(30000)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        return data.items.map(calendar => ({
            id: calendar.id,
            summary: calendar.summary,
            description: calendar.description || '',
            primary: calendar.primary || false,
            accessRole: calendar.accessRole,
            selected: calendar.selected !== false, // Default to true if not specified
            backgroundColor: calendar.backgroundColor,
            foregroundColor: calendar.foregroundColor
        }));
    } catch (error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
            throw new Error('Request timeout while listing calendars');
        }
        throw error;
    }
}

/**
 * Get primary calendar ID for the authenticated user
 */
async function getPrimaryCalendarId(authClient) {
    try {
        const calendars = await listGoogleCalendars(authClient);
        const primaryCalendar = calendars.find(cal => cal.primary);
        
        if (primaryCalendar) {
            console.log(`Primary calendar found: ${primaryCalendar.summary} (${primaryCalendar.id})`);
            return primaryCalendar.id;
        }
        
        // Fallback to 'primary' keyword if no primary calendar found
        console.log('No primary calendar found, using "primary" keyword');
        return 'primary';
    } catch (error) {
        console.warn(`Could not determine primary calendar: ${error.message}`);
        return 'primary'; // Fallback
    }
}

/**
 * Fetch Google Calendar events using Calendar API
 */
async function fetchGoogleCalendarEvents(calendarId, authClient, timeMin, timeMax, maxResults = 2500) {
    try {
        const accessToken = await authClient.getAccessToken();
        
        const params = new URLSearchParams({
            timeMin: timeMin.toISO(),
            timeMax: timeMax.toISO(),
            singleEvents: 'true',
            orderBy: 'startTime',
            maxResults: maxResults.toString()
        });
        
        // Handle special case for 'primary' keyword and email addresses
        let encodedCalendarId;
        if (calendarId === 'primary') {
            encodedCalendarId = 'primary';
        } else {
            // Properly encode calendar ID (especially important for email addresses)
            encodedCalendarId = encodeURIComponent(calendarId);
        }
        
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events?${params}`;
        
        console.log(`  Requesting URL: ${url.substring(0, 100)}...`); // Log first 100 chars for debugging
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken.token}`,
                'User-Agent': 'Node.js Calendar Renderer/1.0'
            },
            signal: AbortSignal.timeout(30000)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`  API Error Details: ${errorText}`);
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Convert Google Calendar events to our format
        return data.items.map(event => ({
            uid: event.id,
            summary: event.summary || 'Untitled Event',
            description: event.description || '',
            start: event.start.dateTime ? new Date(event.start.dateTime) : new Date(event.start.date),
            end: event.end.dateTime ? new Date(event.end.dateTime) : new Date(event.end.date),
            location: event.location || '',
            calendarId: calendarId,
            status: event.status || 'confirmed',
            transparency: event.transparency || 'opaque'
        })).filter(event => event.status === 'confirmed'); // Only include confirmed events
    } catch (error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
            throw new Error('Request timeout');
        }
        
        // Add more context to the error
        if (error.message.includes('Failed to parse URL')) {
            throw new Error(`URL parsing error for calendar ID '${calendarId}': ${error.message}. This might be a calendar ID formatting issue.`);
        }
        
        throw error;
    }
}

/**
 * Fetch data from URL using fetch API (for iCal URLs)
 */
async function fetchUrl(url) {
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Node.js Calendar Renderer/1.0'
            },
            // 30 second timeout
            signal: AbortSignal.timeout(30000)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.text();
    } catch (error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
            throw new Error('Request timeout');
        }
        throw error;
    }
}

/**
 * Fetch and parse calendar data from multiple sources
 */
async function fetchCalendarData(options) {
    const allEvents = [];
    
    // Handle Google Calendar IDs with service account authentication
    if ((options.calendarIds && options.calendarIds.length > 0) || options.includePrimary) {
        if (!options.serviceAccountPath) {
            throw new Error('Service account credentials required for Google Calendar API access');
        }
        
        try {
            console.log('Creating Google Auth client...');
            const authClient = await createGoogleAuthClient(options.serviceAccountPath);
            
            // Determine time range based on view mode
            const now = DateTime.now();
            let timeMin, timeMax;
            
            if (options.viewMode === 'month') {
                timeMin = now.startOf('month');
                timeMax = now.endOf('month');
            } else {
                // Default to week view
                timeMin = now.startOf('week');
                timeMax = timeMin.plus({ days: 6 }).endOf('day');
            }
            
            const calendarIdsToFetch = [...(options.calendarIds || [])];
            
            // Add primary calendar if requested
            if (options.includePrimary) {
                try {
                    const primaryId = await getPrimaryCalendarId(authClient);
                    console.log(`Adding primary calendar: ${primaryId}`);
                    
                    // Avoid duplicates if primary calendar was already specified
                    if (!calendarIdsToFetch.includes(primaryId)) {
                        calendarIdsToFetch.unshift(primaryId); // Add at beginning
                    } else {
                        console.log('Primary calendar already in list, skipping duplicate');
                    }
                } catch (error) {
                    console.warn(`Could not get primary calendar: ${error.message}`);
                }
            }
            
            for (const calendarId of calendarIdsToFetch) {
                try {
                    console.log(`Fetching Google Calendar: ${calendarId}`);
                    
                    // Validate calendar ID format
                    if (!calendarId || calendarId.trim() === '') {
                        console.warn('Skipping empty calendar ID');
                        continue;
                    }
                    
                    const events = await fetchGoogleCalendarEvents(
                        calendarId, 
                        authClient, 
                        timeMin, 
                        timeMax, 
                        options.maxResults
                    );
                    console.log(`  Found ${events.length} events`);
                    allEvents.push(...events);
                } catch (error) {
                    console.warn(`Failed to fetch Google Calendar ${calendarId}: ${error.message}`);
                    
                    // Provide more specific guidance for common errors
                    if (error.message.includes('404') || error.message.includes('Not Found')) {
                        console.warn(`  Calendar '${calendarId}' may not exist or service account lacks access`);
                        console.warn(`  Try running --list-calendars to see available calendars`);
                    } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
                        console.warn(`  Service account lacks permission to access '${calendarId}'`);
                        console.warn(`  Make sure the calendar is shared with the service account email`);
                    }
                }
            }
        } catch (error) {
            console.error(`Google Calendar authentication failed: ${error.message}`);
            throw error;
        }
    }
    
    // Handle iCal URLs (existing functionality)
    if (options.calendarUrls && options.calendarUrls.length > 0) {
        for (const url of options.calendarUrls) {
            try {
                console.log(`Fetching iCal calendar: ${url}`);
                const icalData = await fetchUrl(url);
                
                // Parse iCal data
                const parsedData = ical.parseICS(icalData);
                
                // Extract events
                for (const uid in parsedData) {
                    const event = parsedData[uid];
                    if (event.type === 'VEVENT') {
                        allEvents.push({
                            uid: uid,
                            summary: event.summary || 'Untitled Event',
                            description: event.description || '',
                            start: event.start,
                            end: event.end,
                            location: event.location || '',
                            calendarId: url
                        });
                    }
                }
            } catch (error) {
                console.warn(`Failed to fetch ${url}: ${error.message}`);
            }
        }
    }
    
    return allEvents;
}

/**
 * List available calendars for debugging/setup
 */
async function listCalendars(options) {
    if (!options.serviceAccountPath) {
        throw new Error('Service account credentials required for listing Google Calendars');
    }
    
    try {
        console.log('Creating Google Auth client...');
        const authClient = await createGoogleAuthClient(options.serviceAccountPath);
        
        console.log('Fetching calendar list...\n');
        const calendars = await listGoogleCalendars(authClient);
        
        console.log('Available Calendars:');
        console.log('===================');
        
        calendars.forEach((calendar, index) => {
            console.log(`${index + 1}. ${calendar.summary}`);
            console.log(`   ID: ${calendar.id}`);
            console.log(`   Access: ${calendar.accessRole}`);
            console.log(`   Primary: ${calendar.primary ? 'Yes' : 'No'}`);
            console.log(`   Selected: ${calendar.selected ? 'Yes' : 'No'}`);
            if (calendar.description) {
                console.log(`   Description: ${calendar.description}`);
            }
            console.log('');
        });
        
        const primaryCalendar = calendars.find(cal => cal.primary);
        if (primaryCalendar) {
            console.log(`Primary Calendar: ${primaryCalendar.summary} (${primaryCalendar.id})`);
        }
        
        console.log(`\nTo use these calendars, run:`);
        console.log(`node ical2png.js --google-calendar "CALENDAR_ID" --service-account "${options.serviceAccountPath}"`);
        console.log(`\nFor primary calendar only:`);
        console.log(`node ical2png.js --include-primary --service-account "${options.serviceAccountPath}"`);
        console.log(`\nExample with actual calendar ID:`);
        if (calendars.length > 0) {
            const exampleCalendar = calendars[0];
            console.log(`node ical2png.js --google-calendar "${exampleCalendar.id}" --service-account "${options.serviceAccountPath}"`);
        }
    } catch (error) {
        console.error(`Failed to list calendars: ${error.message}`);
        throw error;
    }
}

/**
 * Filter events for a specific time period
 */
function filterEventsForPeriod(events, startDate, endDate) {
    return events
        .filter(event => {
            if (!event.start) return false;
            
            const eventStart = DateTime.fromJSDate(event.start);
            const periodStart = DateTime.fromJSDate(startDate);
            const periodEnd = DateTime.fromJSDate(endDate);
            
            return eventStart >= periodStart && eventStart <= periodEnd;
        })
        .map(event => ({
            summary: event.summary,
            start: DateTime.fromJSDate(event.start),
            description: event.description,
            location: event.location,
            calendarId: event.calendarId
        }))
        .sort((a, b) => a.start.toMillis() - b.start.toMillis());
}

/**
 * Create canvas with e-ink optimized colors
 */
function createCanvas2D(width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Set white background
    ctx.fillStyle = COLORS.white;
    ctx.fillRect(0, 0, width, height);
    
    return { canvas, ctx };
}

/**
 * Set up font if available
 */
function setupFont(ctx, fontPath) {
    try {
        // Try to register custom font
        if (fontPath && require('fs').existsSync(fontPath)) {
            registerFont(fontPath, { family: 'CustomFont' });
            return 'CustomFont';
        }
    } catch (error) {
        console.warn(`Could not load font ${fontPath}: ${error.message}`);
    }
    
    // Fallback to system fonts
    return 'Arial, sans-serif';
}

/**
 * Render week view
 */
function renderWeekView(ctx, width, height, events, fontFamily) {
    const now = DateTime.now();
    const startOfWeek = now.startOf('week');
    const endOfWeek = startOfWeek.plus({ days: 6 }).endOf('day');
    
    const weekEvents = filterEventsForPeriod(events, startOfWeek.toJSDate(), endOfWeek.toJSDate());
    
    // Draw title
    ctx.fillStyle = COLORS.black;
    ctx.font = `16px ${fontFamily}`;
    const title = startOfWeek.toFormat('\'Week of\' MMMM dd, yyyy');
    ctx.fillText(title, 10, 30);
    
    // Draw day headers
    const dayWidth = (width - 20) / 7;
    const headerY = 50;
    
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const day = startOfWeek.plus({ days: dayOffset });
        const dayName = day.toFormat('ccc dd');
        const x = 10 + (dayOffset * dayWidth);
        
        // Draw day header background
        ctx.fillStyle = COLORS.blue;
        ctx.fillRect(x, headerY, dayWidth - 2, 25);
        
        // Draw day header text
        ctx.fillStyle = COLORS.white;
        ctx.font = `12px ${fontFamily}`;
        ctx.fillText(dayName, x + 5, headerY + 18);
    }
    
    // Draw events
    const eventY = headerY + 35;
    const eventHeight = 30;
    const maxEventsPerDay = Math.floor((height - eventY - 10) / eventHeight);
    
    // Group events by day
    const eventsByDay = {};
    weekEvents.forEach(event => {
        const dayKey = event.start.toISODate();
        if (!eventsByDay[dayKey]) {
            eventsByDay[dayKey] = [];
        }
        eventsByDay[dayKey].push(event);
    });
    
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const day = startOfWeek.plus({ days: dayOffset });
        const dayKey = day.toISODate();
        const x = 10 + (dayOffset * dayWidth);
        
        const eventsToday = eventsByDay[dayKey] || [];
        let eventCount = 0;
        
        for (const event of eventsToday) {
            if (eventCount >= maxEventsPerDay) break;
            
            const y = eventY + (eventCount * eventHeight);
            const timeStr = event.start.toFormat('HH:mm');
            const summary = event.summary.substring(0, 20); // Truncate long titles
            
            // Draw event box
            ctx.fillStyle = COLORS.yellow;
            ctx.fillRect(x, y, dayWidth - 2, eventHeight - 2);
            
            ctx.strokeStyle = COLORS.black;
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, dayWidth - 2, eventHeight - 2);
            
            // Draw event text
            ctx.fillStyle = COLORS.black;
            ctx.font = `10px ${fontFamily}`;
            ctx.fillText(timeStr, x + 2, y + 10);
            ctx.fillText(summary, x + 2, y + 20);
            
            eventCount++;
        }
        
        // Show "+N more" if there are more events
        if (eventsToday.length > maxEventsPerDay) {
            const moreCount = eventsToday.length - maxEventsPerDay;
            const y = eventY + (maxEventsPerDay * eventHeight);
            ctx.fillStyle = COLORS.red;
            ctx.font = `8px ${fontFamily}`;
            ctx.fillText(`+${moreCount} more`, x + 2, y + 10);
        }
    }
}

/**
 * Render month view
 */
function renderMonthView(ctx, width, height, events, fontFamily) {
    const now = DateTime.now();
    const startOfMonth = now.startOf('month');
    const endOfMonth = now.endOf('month');
    
    const monthEvents = filterEventsForPeriod(events, startOfMonth.toJSDate(), endOfMonth.toJSDate());
    
    // Draw title
    ctx.fillStyle = COLORS.black;
    ctx.font = `18px ${fontFamily}`;
    const title = startOfMonth.toFormat('MMMM yyyy');
    ctx.fillText(title, 10, 30);
    
    // Calendar grid
    const gridStartY = 50;
    const cellWidth = (width - 20) / 7;
    const cellHeight = (height - gridStartY - 10) / 6;
    
    // Draw day headers
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 0; i < 7; i++) {
        const x = 10 + (i * cellWidth);
        ctx.fillStyle = COLORS.black;
        ctx.font = `12px ${fontFamily}`;
        ctx.fillText(dayNames[i], x + 5, gridStartY + 20);
    }
    
    // Calculate first day of month position (0=Sunday)
    const firstDayDow = startOfMonth.weekday % 7;
    
    // Group events by day
    const eventsByDay = {};
    monthEvents.forEach(event => {
        const dayKey = event.start.day;
        if (!eventsByDay[dayKey]) {
            eventsByDay[dayKey] = [];
        }
        eventsByDay[dayKey].push(event);
    });
    
    const daysInMonth = endOfMonth.day;
    
    for (let day = 1; day <= daysInMonth; day++) {
        const position = firstDayDow + day - 1;
        const row = Math.floor(position / 7);
        const col = position % 7;
        
        const x = 10 + (col * cellWidth);
        const y = gridStartY + 30 + (row * cellHeight);
        
        // Draw cell border
        ctx.strokeStyle = COLORS.black;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cellWidth, cellHeight);
        
        // Draw day number
        ctx.fillStyle = COLORS.black;
        ctx.font = `10px ${fontFamily}`;
        ctx.fillText(day.toString(), x + 3, y + 15);
        
        // Draw event indicators
        const eventsToday = eventsByDay[day] || [];
        const indicatorY = y + 20;
        const maxIndicators = Math.floor((cellHeight - 25) / 8);
        
        for (let i = 0; i < Math.min(eventsToday.length, maxIndicators); i++) {
            const event = eventsToday[i];
            const dotColor = (i % 2 === 0) ? COLORS.red : COLORS.green;
            
            // Draw small event indicator
            ctx.fillStyle = dotColor;
            ctx.fillRect(x + 3, indicatorY + (i * 8), 5, 3);
            
            // Truncate and draw event title
            const shortTitle = event.summary.substring(0, 8);
            ctx.fillStyle = COLORS.black;
            ctx.font = `6px ${fontFamily}`;
            ctx.fillText(shortTitle, x + 12, indicatorY + (i * 8) + 3);
        }
        
        // Show count if more events
        if (eventsToday.length > maxIndicators) {
            const moreCount = eventsToday.length - maxIndicators;
            ctx.fillStyle = COLORS.orange;
            ctx.font = `6px ${fontFamily}`;
            ctx.fillText(`+${moreCount}`, x + 3, y + cellHeight - 5);
        }
    }
}

/**
 * Main rendering function
 */
async function renderCalendar(options) {
    console.log('Fetching calendar data...');
    const events = await fetchCalendarData(options);
    console.log(`Found ${events.length} events`);
    
    console.log('Creating image...');
    const { canvas, ctx } = createCanvas2D(options.width, options.height);
    const fontFamily = setupFont(ctx, options.fontPath);
    
    if (options.viewMode === 'week') {
        console.log('Rendering week view...');
        renderWeekView(ctx, options.width, options.height, events, fontFamily);
    } else if (options.viewMode === 'month') {
        console.log('Rendering month view...');
        renderMonthView(ctx, options.width, options.height, events, fontFamily);
    } else {
        throw new Error(`Invalid view mode: ${options.viewMode} (use 'week' or 'month')`);
    }
    
    console.log(`Saving to ${options.outputFile}...`);
    
    // Save as PNG
    const buffer = canvas.toBuffer('image/png');
    await fs.writeFile(options.outputFile, buffer);
    
    console.log('Calendar rendered successfully!');
}

/**
 * Command line interface
 */
function setupCLI() {
    const program = new Command();
    
    program
        .name('calendar-renderer')
        .description('Fetch calendars and render as PNG for e-ink displays')
        .version('1.1.0');
    
    program
        .option('--width <number>', 'Image width', (val) => parseInt(val), config.width)
        .option('--height <number>', 'Image height', (val) => parseInt(val), config.height)
        .option('--view <mode>', 'View mode: week or month', config.viewMode)
        .option('--output <file>', 'Output PNG file', config.outputFile)
        .option('--calendar <url>', 'Calendar URL (can be specified multiple times)', (url, urls) => {
            urls.push(url);
            return urls;
        }, [])
        .option('--google-calendar <id>', 'Google Calendar ID (can be specified multiple times)', (id, ids) => {
            ids.push(id);
            return ids;
        }, [])
        .option('--include-primary', 'Include the primary Google Calendar')
        .option('--service-account <path>', 'Path to Google service account JSON file')
        .option('--font <path>', 'TrueType font path', config.fontPath)
        .option('--max-results <number>', 'Maximum number of events to fetch per calendar', (val) => parseInt(val), config.maxResults)
        .option('--list-calendars', 'List available Google Calendars and exit')
        .option('--help-examples', 'Show usage examples')
        .action(async (options) => {
            if (options.helpExamples) {
                showExamples();
                return;
            }
            
            if (options.listCalendars) {
                if (!options.serviceAccount) {
                    console.error('Error: Service account credentials required to list calendars');
                    console.log('Use --service-account to specify the path to your service account JSON file');
                    process.exit(1);
                }
                
                const listOptions = {
                    serviceAccountPath: options.serviceAccount
                };
                
                try {
                    await listCalendars(listOptions);
                } catch (error) {
                    console.error('Error:', error.message);
                    process.exit(1);
                }
                return;
            }
            
            if (!options.includePrimary && options.calendar.length === 0 && options.googleCalendar.length === 0) {
                console.error('Error: At least one calendar source must be specified');
                console.log('Options: --calendar, --google-calendar, or --include-primary');
                console.log('Use --help for usage information or --list-calendars to see available calendars');
                process.exit(1);
            }
            
            if ((options.googleCalendar.length > 0 || options.includePrimary) && !options.serviceAccount) {
                console.error('Error: Service account credentials required when using Google Calendar features');
                console.log('Use --service-account to specify the path to your service account JSON file');
                process.exit(1);
            }
            
            const renderOptions = {
                width: options.width,
                height: options.height,
                viewMode: options.view,
                outputFile: options.output,
                calendarUrls: options.calendar,
                calendarIds: options.googleCalendar,
                includePrimary: options.includePrimary,
                serviceAccountPath: options.serviceAccount,
                fontPath: options.font,
                maxResults: options.maxResults
            };
            
            try {
                await renderCalendar(renderOptions);
            } catch (error) {
                console.error('Error:', error.message);
                process.exit(1);
            }
        });

    program.parse();

    return program;
}

/**
 * Show usage examples
 */
function showExamples() {
    console.log(`
Enhanced Usage Examples for Personal Private Google Calendars:

# PRIMARY CALENDAR (most common for personal use)
node ical2png.js \\
    --include-primary \\
    --service-account "/path/to/service-account.json" \\
    --view week

# List all available calendars first (recommended)
node ical2png.js \\
    --list-calendars \\
    --service-account "/path/to/service-account.json"

# Primary calendar + specific additional calendars
node ical2png.js \\
    --include-primary \\
    --google-calendar "family@group.calendar.google.com" \\
    --service-account "/path/to/service-account.json" \\
    --view month

# Multiple personal calendars by ID
node ical2png.js \\
    --google-calendar "your-email@gmail.com" \\
    --google-calendar "work@group.calendar.google.com" \\
    --service-account "/path/to/service-account.json" \\
    --view week

# Mix everything: primary + specific calendars + iCal
node ical2png.js \\
    --include-primary \\
    --google-calendar "work@group.calendar.google.com" \\
    --calendar "https://calendar.google.com/calendar/ical/public/basic.ics" \\
    --service-account "/path/to/service-account.json" \\
    --view week

# High-resolution output with custom limits
node ical2png.js \\
    --include-primary \\
    --service-account "/path/to/service-account.json" \\
    --width 1200 --height 800 \\
    --max-results 5000 \\
    --view month --output large-calendar.png

SETUP FOR PERSONAL PRIVATE CALENDARS:

1. Create Google Cloud Project:
   - Go to https://console.cloud.google.com/
   - Create new project or select existing one
   - Enable Google Calendar API

2. Create Service Account:
   - Go to "Credentials" → "Create Credentials" → "Service Account"
   - Give it a descriptive name like "Calendar Display"
   - Download the JSON key file (keep it secure!)

3. Share Your Personal Calendar:
   - Open Google Calendar (calendar.google.com)
   - Click the gear icon → Settings
   - In the left sidebar, click on your calendar name
   - Scroll to "Share with specific people"
   - Click "Add people" and enter the service account email
     (found in the JSON file as "client_email")
   - Set permission to "See all event details"

4. Find Your Calendar ID:
   - Still in calendar settings, scroll to "Integrate calendar"
   - Copy the "Calendar ID" (usually your-email@gmail.com for primary)
   - Or use --list-calendars to see all available calendars

QUICK START FOR PERSONAL USE:
1. Follow setup steps 1-3 above
2. Use --include-primary flag (easiest for personal calendars)
3. Run: node ical2png.js --include-primary --service-account path/to/service.json

TROUBLESHOOTING:
- Use --list-calendars to verify your service account has access
- Primary calendar ID is usually your Gmail address
- Make sure service account email has "See all event details" permission
- Check that Calendar API is enabled in Google Cloud Console

Package.json dependencies (same as before):
{
  "dependencies": {
    "canvas": "^2.11.2",
    "ical": "^0.8.0",
    "luxon": "^3.4.4",
    "commander": "^11.1.0",
    "google-auth-library": "^9.4.0"
  }
}

Install with: npm install canvas ical luxon commander google-auth-library
`);
}

setupCLI();
