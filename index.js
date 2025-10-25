
const TICKS_PER_BEAT = 480;
const DEFAULT_BPM = 130;
const MICROSECONDS_PER_MINUTE = 60000000;

const midiFiles = [];
let selectedFolderName = "Converted_Midis";

const status = document.getElementById('status');
const fileInput = document.getElementById('fileInput');
const fileNames = document.getElementById('fileNames');
const downloadBtn = document.getElementById('downloadBtn');
const copyBtn = document.getElementById('copyBtn');

// Log colored messages to console div
function logStatus(msg, type = "info", append = true) {
    const span = document.createElement("span");
    span.textContent = msg + "\n";

    if (type === "error") {
        span.className = "msg-error";      // render in red
    } else if (type === "success") {
        span.className = "msg-success";    // render in green
    } else {
        span.className = "msg-info";       // render in grey
    }

    if (!append) {
        status.textContent = "";
    }
    status.appendChild(span);
    status.scrollTop = status.scrollHeight;
}


// fileInput.addEventListener("change", () => {
//     if (fileInput.files.length > 0) {
//         fileNames.textContent = fileInput.files.length + " file(s) searched for xml or gzip header.";
//         logStatus("The folder " + selectedFolderName + " has a total of " + fileInput.files.length + " file(s).", "info");   
//     } else {
//         fileNames.textContent = "No folder selected";
//     }
// });








function clearStatus() {
    status.textContent = "";
}

function writeVarLen(value) {
    if (value < 0) value = 0;
    let bytes = [value & 0x7f];
    value >>= 7;
    while (value > 0) {
        bytes.push((value & 0x7f) | 0x80);
        value >>= 7;
    }
    return new Uint8Array(bytes.reverse());
}

function encodeString(str) {
    return new Uint8Array([...str].map(c => c.charCodeAt(0)));
}

function writeUint32(num) {
    return new Uint8Array([
        (num >> 24) & 0xff,
        (num >> 16) & 0xff,
        (num >> 8) & 0xff,
        num & 0xff,
    ]);
}

function writeUint16(num) {
    return new Uint8Array([
        (num >> 8) & 0xff,
        num & 0xff,
    ]);
}

function isAbletonXml(doc) {
    return doc.querySelector('KeyTrack') !== null && doc.querySelector('MidiNoteEvent') !== null;
}

function getLoopBounds(doc) {
    const loopEl = doc.querySelector('Loop');
    if (!loopEl) return { loopStart: 0, loopEnd: 8 };
    const loopStartEl = loopEl.querySelector('LoopStart');
    const loopEndEl = loopEl.querySelector('LoopEnd');
    return {
        loopStart: loopStartEl ? parseFloat(loopStartEl.getAttribute('Value') || loopStartEl.textContent) || 0 : 0,
        loopEnd: loopEndEl ? parseFloat(loopEndEl.getAttribute('Value') || loopEndEl.textContent) || 8 : 8,
    };
}

function xmlToMidiBytesWithLoop(xmlText, filename) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "application/xml");
    if (xmlDoc.getElementsByTagName('parsererror').length > 0)
        throw new Error('Invalid XML');
    if (!isAbletonXml(xmlDoc))
        throw new Error('Not Ableton XML structure');

    const { loopStart, loopEnd } = getLoopBounds(xmlDoc);
    const trackLengthTicks = Math.round((loopEnd - loopStart) * TICKS_PER_BEAT);
    const microsecondsPerQuarter = Math.floor(MICROSECONDS_PER_MINUTE / DEFAULT_BPM);

    const keyTracks = Array.from(xmlDoc.querySelectorAll('KeyTrack'));
    if (keyTracks.length === 0)
        throw new Error('No <KeyTrack> elements found');

    const noteEvents = [];

    keyTracks.forEach((keyTrack, idx) => {
        const midiChannel = idx % 16;
        const midiKeyEl = keyTrack.querySelector('MidiKey');
        if (!midiKeyEl) return;
        const baseNote = parseInt(midiKeyEl.getAttribute('Value'), 10);
        const notes = Array.from(keyTrack.querySelectorAll('MidiNoteEvent'));
        notes.forEach(noteEl => {
            let start = parseFloat(noteEl.getAttribute('Time')) - loopStart;
            if (start < 0) start = 0;
            const duration = parseFloat(noteEl.getAttribute('Duration'));
            let velocity = Math.round(parseFloat(noteEl.getAttribute('Velocity')));
            velocity = Math.min(127, Math.max(1, velocity));
            const offVelocity = parseInt(noteEl.getAttribute('OffVelocity'), 10) || 64;
            const midiNote = baseNote;
            const startTick = Math.round(start * TICKS_PER_BEAT);
            const offTick = startTick + Math.round(duration * TICKS_PER_BEAT);
            noteEvents.push({ tick: startTick, type: 'noteOn', note: midiNote, velocity, channel: midiChannel });
            noteEvents.push({ tick: offTick, type: 'noteOff', note: midiNote, velocity: offVelocity, channel: midiChannel });
        });
    });

    if (noteEvents.length === 0)
        throw new Error('No MidiNoteEvent parsed');

    noteEvents.sort((a, b) => {
        if (a.tick !== b.tick) return a.tick - b.tick;
        if (a.type !== b.type) return a.type === 'noteOff' ? -1 : 1;
        return 0;
    });

    const trackData = [];
    let currentTick = 0;

    for (const ev of noteEvents) {
        const delta = ev.tick - currentTick;
        currentTick = ev.tick;
        trackData.push(...writeVarLen(delta));
        const statusByte = (ev.type === 'noteOn' ? 0x90 : 0x80) | (ev.channel & 0xf);
        trackData.push(statusByte, ev.note & 0x7f, ev.velocity & 0x7f);
    }
    if (currentTick < trackLengthTicks) {
        trackData.push(...writeVarLen(trackLengthTicks - currentTick));
    }
    trackData.push(0x00, 0xFF, 0x2F, 0x00);

    const headerChunk = [
        ...encodeString("MThd"),
        ...writeUint32(6),
        ...writeUint16(0),
        ...writeUint16(1),
        ...writeUint16(TICKS_PER_BEAT)
    ];

    const tempoEvent = [
        0x00, 0xFF, 0x51, 0x03,
        (microsecondsPerQuarter >> 16) & 0xFF,
        (microsecondsPerQuarter >> 8) & 0xFF,
        microsecondsPerQuarter & 0xFF
    ];

    const trackChunkData = [...tempoEvent, ...trackData];
    const trackChunk = [
        ...encodeString("MTrk"),
        ...writeUint32(trackChunkData.length),
        ...trackChunkData
    ];

    return new Uint8Array([...headerChunk, ...trackChunk]);
}

async function processFile(file) {
    try {
        const header = await file.slice(0, 3).arrayBuffer();
        const headerView = new Uint8Array(header);
        const isGzip = headerView.length >= 3 && headerView[0] === 0x1f && headerView[1] === 0x8b && headerView[2] === 0x08;
        let text;

        if (isGzip) {
            const arrayBuffer = await file.arrayBuffer();
            const decompressed = fflate.gunzipSync(new Uint8Array(arrayBuffer));
            text = new TextDecoder().decode(decompressed);
        } else {
            text = await file.text();
        }

        const xmlDoc = new DOMParser().parseFromString(text, "application/xml");
        if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
            // logStatus(`Skipped non-Ableton XML: ${file.name}`, "error");
            // One-line version: include full relative path in console
            const filePath = file.webkitRelativePath || file.name;
            logStatus(`Skipped non-Ableton XML:`, "error");
            logStatus(`./${filePath}`, "error");
            return false;
        }
        if (!isAbletonXml(xmlDoc)) {
            // logStatus("Not Ableton XML structure", "error");
            // One-line version: include full relative path in console
            const filePath = file.webkitRelativePath || file.name;
            logStatus(`Not Ableton XML structure:`, "error");
            logStatus(`./${filePath}`, "error");
            return false;
        }





        try {
            const midiBytes = xmlToMidiBytesWithLoop(text, file.name);
            const relativePath = file.webkitRelativePath
                ? file.webkitRelativePath + ".mid"
                : file.name + ".mid";
            midiFiles.push({ name: file.name, data: midiBytes, path: relativePath });
            // logStatus(`Converted: ${file.name}`, "success");
            // Show one-line converted file and its destination path
            const outputPath = file.webkitRelativePath
                ? "./" + file.webkitRelativePath + ".mid"
                : "./" + file.name + ".mid";
            logStatus(`Converted: ${file.name} to:`, "success");
            logStatus(`${outputPath}`, "success");

            return true;
        } catch (e) {
            logStatus(`Error in "${file.name}": ${e.message}`, "error");
            return false;
        }
    } catch (e) {
        logStatus(`Error processing "${file.name}": ${e.message}`, "error");
        return false;
    }
}

async function parseFiles(files) {
    if (!files || files.length === 0) {
        logStatus("Folder selection canceled — no files processed.", "info");
        return;
    }

    clearStatus(); // only clear if we have files to process
    midiFiles.length = 0;

    // rest of your parsing logic here...
    if (files[0].webkitRelativePath) {
        const parts = files[0].webkitRelativePath.split("/");
        if (parts.length > 1) selectedFolderName = parts[0];
    }

    let successCount = 0;
    for (let i = 0; i < files.length; i++) {
        if (await processFile(files[i])) successCount++;
    }

    if (successCount > 0) {
        downloadBtn.disabled = false;
        copyBtn.disabled = false;
        logStatus(`Conversion complete: ${successCount} MIDI file(s) are ready to download as a zipfile to your Downloads-folder.`);
    } else {
        downloadBtn.disabled = true;
        copyBtn.disabled = true;
        logStatus('No valid files converted.', 'error');
    }
}



fileInput.addEventListener("change", e => {
    if (fileInput.files.length > 0) {
        fileNames.textContent = "The folder " + selectedFolderName + " has a total of " + fileInput.files.length + " file(s).";
        parseFiles(fileInput.files);
        logStatus("The folder " + selectedFolderName + " has a total of " + fileInput.files.length + " file(s).", "info");
    } else if (fileInput.value === "") {
        // user canceled the file picker
        fileNames.textContent = "Selecting new folder was canceled. Previous folder is still selected";
        logStatus("Folder selection canceled — keeping previous files and console output.", "info");
    } else {
        fileNames.textContent = "No folder selected";
    }
});

function zipAndDownload() {
    if (midiFiles.length === 0) return;

    const zipEntries = {};

    // Add MIDI files, trimming the initial folder so there's only one root
    midiFiles.forEach(({ path, data }) => {
        // Remove leading "selectedFolderName/" if present
        const relativePath = path.startsWith(selectedFolderName + "/")
            ? path.substring(selectedFolderName.length + 1)
            : path;

        // Place each file inside one root folder in the ZIP
        zipEntries[selectedFolderName + "/" + relativePath] = data;
    });

    // Now add your log file directly in the same top-level folder
    const now = new Date().toLocaleString();
    const logHeader = `Log generated: ${now}\nProject folder: ${selectedFolderName}\n\n=== Debug Console ===\n\n`;
    const logContent = logHeader + (status.textContent.trim() || "No debug info collected.");
    const encoder = new TextEncoder();
    zipEntries[`${selectedFolderName}/${selectedFolderName}-log.txt`] = encoder.encode(logContent);

    // Append ZIP structure overview before saving log.txt

    // Divider lines and section title
    const divider = "-------------------------------------------";
    let structureSection = `\n${divider}\n--- ZIP FILE, FOLDER STRUCTURE\n--- File: ${selectedFolderName}.zip\n${divider}\n`;

    // Build readable folder/file structure based on converted MIDI files
    midiFiles.forEach(({ path }) => {
        const cleanPath = path.replace(/\\/g, "/"); // Ensure consistent slashes
        structureSection += cleanPath + "\n";
    });

    // Add the new structure overview to the end of the log text
    const fullLog = logHeader + (status.textContent.trim() || "No debug info collected.") + "\n" + structureSection;

    // Replace previous logContent with the updated one
    zipEntries[`${selectedFolderName}/${selectedFolderName}-log.txt`] = encoder.encode(fullLog);


    fflate.zip(zipEntries, { level: 9 }, (err, zipped) => {
        if (err) {
            alert('ZIP error: ' + err.message);
            logStatus(`Something is wrong with the zipping process.`, "error");
            return;
        }
        const blob = new Blob([zipped], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedFolderName}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        logStatus(`${selectedFolderName}.zip is downloaded to your Downloads folder.`, "info");
    });
}

function copyFeedbackToClipboard() {
    if (!navigator.clipboard) {
        alert('Clipboard API not available');
        return;
    }

    navigator.clipboard.writeText(status.textContent)
        .then(() => {
            logStatus('Debug info copied to clipboard', 'info');
        })
        .catch(() => {
            alert('Failed to copy debug info');
            logStatus('Failed to copy debug info to clipboard', 'error');
        });
}


downloadBtn.addEventListener('click', zipAndDownload);
copyBtn.addEventListener('click', copyFeedbackToClipboard);
