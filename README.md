<div align="center">

<img src="docs/banner.png" alt="Completely made with AI: Vibe Editing Suite was designed, written, tested and packaged by Claude (Anthropic) from plain-English instructions." width="100%">

</div>

<div align="center">

# Vibe Editing Suite

</div>

<div align="center">

A Windows video editor and image editor focused on simplicity with many features content creators need  
**Every line of it was written by AI.**

</div>

<div align="center">

[![Download](https://img.shields.io/github/v/release/phsrp/Vibe-editing-suite?label=download&color=c4a7e7&style=for-the-badge)](https://github.com/phsrp/Vibe-editing-suite/releases/latest) ![Made with AI](https://img.shields.io/badge/made%20with-AI-ebbcba?style=for-the-badge) ![Windows](https://img.shields.io/badge/platform-Windows-31748f?style=for-the-badge)

</div>

<div align="center">

## Tutorial included, don't worry

*(for new users: there is an included tutorial, do not worry)*

The first time you open the video editor or the image editor, a short tour shows you the key features, one step at a time. You can skip it, and replay it any time with the **Tutorial** button at the top.

<img src="docs/screenshots/tutorial-video.png" alt="The tutorial in the video editor, explaining Transform and Funny warp" width="48%"> <img src="docs/screenshots/tutorial-image.png" alt="The tutorial in the image editor, explaining Transform and Funny warp" width="48%">

</div>

## Built with

- [Electron](https://www.electronjs.org/) and [React](https://react.dev/), with WebGL for the preview and transitions
- [FFmpeg](https://ffmpeg.org/) through `ffmpeg-static` for import, audio and export. **Note:** that FFmpeg build includes GPL-licensed encoders (x264 and x265), which matters if you redistribute the installer.
- Transition format from [gl-transitions](https://gl-transitions.com/)
- [Montserrat](https://github.com/JulietaUla/Montserrat) font (SIL Open Font License)
- [Rosé Pine](https://rosepinetheme.com/) colours (MIT)
- [SAM 2.1](https://github.com/facebookresearch/sam2) by Meta (Apache-2.0), exported to ONNX for the browser by [Diffusion Studio](https://huggingface.co/diffusionstudio/sam2.1-small-video-onnx-fp16) (Apache-2.0), for smart select and mask tracking. The distractor-aware memory is [DAM4SAM](https://github.com/jovanavidenovic/DAM4SAM) by Videnovic et al. (Apache-2.0). How its video loop fits together follows Meta's code and the open reference runtime in [diffusionstudio/editor](https://github.com/diffusionstudio/editor/tree/main/packages/sam2) (MPL-2.0). It is downloaded on request, not included in the installer.
- [ONNX Runtime Web](https://onnxruntime.ai/) (MIT) to run that model on your PC
- Icons drawn in the style of [Lucide](https://lucide.dev/) (ISC)
