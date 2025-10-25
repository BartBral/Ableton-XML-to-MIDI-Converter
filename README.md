# Ableton-XML-to-MIDI-Converter
Ableton XML to MIDI Converter, Select an Ableton project folder or any directory containing .alc, .agr, .xml, .als, or .adv files, whether compressed or not. The tool scans all subfolders, converts found MIDI data to .mid files, and zips them while preserving the folder structure for you to download.  

No files ever leave your computer—they’re only saved locally to your Downloads folder. Ableton often uses gzip compression, which the tool automatically decompresses. Any unprocessable files will trigger an error message in the console.  

It extracts MIDI note data from the XML and converts it into MIDI format; files without notes are skipped. While .alc and .agr files usually contain usable MIDI data, .als files may produce poor results or cause playback issues since all notes are merged into one MIDI channel.  

[>>> TRY IT HERE <<<](https://bartbral.github.io/Ableton-XML-to-MIDI-Converter)
