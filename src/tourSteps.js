// The first-run tutorial: one short step per key feature, not in detail.
// target = CSS selector(s) searched inside the editor (the first one that is on screen is highlighted).
// A step without a target (or whose target is not there) is shown in the middle of the window.

export const VIDEO_STEPS = [
  {
    title: 'Welcome to the video editor',
    text: 'A one-minute tour of the main things. You can leave it any time, and replay it later with the Tutorial button at the top.',
  },
  {
    target: '.bin .btn-row',
    title: 'Bring in your files',
    text: 'Import videos, images and music here, or just drop files onto the window. Double-click one to put it on the timeline.',
  },
  {
    target: '.library',
    title: 'Library',
    text: 'Keep things you use again and again (an intro, a logo, a song) so they are one click away in every project.',
  },
  {
    target: '.preview-area',
    title: 'Preview',
    text: 'Your video plays here. Hold Ctrl and use the mouse wheel to zoom into the picture, which helps when you draw masks.',
  },
  {
    target: '.tl-scroll',
    title: 'Timeline',
    text: 'Drag clips to move them and drag their edges to trim. Drag a clip sideways to leave a gap. Add more tracks to stack videos on top of each other.',
  },
  {
    target: '.tl-toolbar',
    title: 'Timeline tools',
    text: 'Split a clip at the playhead, freeze a frame, group clips, add markers, and record a voice-over. Hover a button to see what it does.',
  },
  {
    target: '.tl-toolbar button[title^="Add text"]',
    title: 'Text and titles',
    text: 'Adds a text clip at the playhead. Pick a style and a font in the inspector on the right.',
  },
  {
    target: '.tl-toolbar button[title^="Captions"]',
    title: 'Captions',
    text: 'Turns the words in your video into text clips, timed to the speech, and can save a subtitles file. It needs a one-time model download, and works offline after that.',
  },
  {
    target: ['[data-sec="transform"]', '.inspector'],
    title: 'Move, resize and warp',
    text: 'Click a clip, then use Transform to move, resize and rotate it, with keyframes to animate it. Funny warp lets you drag the four corners to bend the picture.',
  },
  {
    target: ['[data-sec="transition"]', '.inspector'],
    title: 'Transitions',
    text: 'Pick a transition that plays when one clip changes into the next. You can add your own too.',
  },
  {
    target: ['[data-sec="mask"]', '.inspector'],
    title: 'Masks and AI select',
    text: 'Show only part of a clip. Smart select finds a person or object with a click and can follow it as it moves. It needs a graphics card and a one-time model download.',
  },
  {
    target: ['[data-sec="effects"]', '.inspector'],
    title: 'Effects and colour',
    text: 'Blur, glow, green screen and colour correction. Speed and reverse for a clip are in this panel too.',
  },
  {
    target: '.aspect-select',
    title: 'Video shape',
    text: 'Choose landscape, vertical for phones, square and more.',
  },
  {
    target: '.topbar button[title^="Version"]',
    title: 'History',
    text: 'Earlier copies of your project are kept, so you can go back if something goes wrong.',
  },
  {
    target: '.topbar .primary',
    title: 'Export',
    text: 'When you are happy, export your video as MP4. You can pick quality, a graphics card for speed, or audio only.',
  },
  {
    title: 'That is the tour',
    text: 'Have fun. Hovering over almost any button shows what it does. Press the Tutorial button at the top to see this again.',
  },
]

export const IMAGE_STEPS = [
  {
    title: 'Welcome to the image editor',
    text: 'A short tour of the main things. You can leave it any time, and replay it later with the Tutorial button at the top.',
  },
  {
    target: '.toolbar-v',
    title: 'Tools',
    text: 'Move, brush, eraser, line, shapes, eyedropper and text. Hover a tool to see its key. The brush and eraser show a circle of their size.',
  },
  {
    target: '.layers .layer-add',
    title: 'Layers',
    text: 'Everything lives on its own layer: pictures, paint and text. Add one here, then drag layers up and down to change what is on top.',
  },
  {
    target: ['.layers .layer-row', '.layers .bin-list'],
    title: 'Hide, lock and fade',
    text: 'Use the eye to hide a layer and the lock to protect it. Double-click a name to rename it.',
  },
  {
    target: '.preview-area',
    title: 'The canvas',
    text: 'Hold Ctrl and use the mouse wheel to zoom in, and drag with the middle mouse button to move around. Great for tight masks.',
  },
  {
    target: ['[data-sec="transform"]', '.inspector'],
    title: 'Move, resize and warp',
    text: 'Click a layer, then use Transform to move, resize and rotate it, and change its opacity. Funny warp lets you drag the four corners to bend it.',
  },
  {
    target: ['[data-sec="mask"]', '.inspector'],
    title: 'Masks and AI select',
    text: 'Show only part of a layer. Smart select finds a subject with a click. It needs a graphics card and a one-time model download.',
  },
  {
    target: ['[data-sec="effects"]', '.inspector'],
    title: 'Effects and colour',
    text: 'Blur, glow, green screen and colour correction for the selected layer.',
  },
  {
    target: ['[data-sec="canvas"]', '.inspector'],
    title: 'Canvas size',
    text: 'With no layer selected, change the size and the background of the canvas here.',
  },
  {
    target: '.topbar button[title^="Undo"]',
    title: 'Undo',
    text: 'Made a mistake? Undo (Ctrl+Z) takes back a stroke, a move or a layer. Redo is Ctrl+Y.',
  },
  {
    target: '.topbar .primary',
    title: 'Export',
    text: 'Save your picture as PNG, JPG or WebP, at the canvas size or bigger.',
  },
  {
    title: 'That is the tour',
    text: 'Have fun. Hovering over almost any button shows what it does. Press the Tutorial button at the top to see this again.',
  },
]
