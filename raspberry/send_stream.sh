#!/bin/bash

gst-launch-1.0 v4l2src device=/dev/video0 \
  ! image/jpeg,width=640,height=480,framerate=30/1 \
  ! jpegparse \
  ! rtpjpegpay \
  ! udpsink host=100.81.175.3 port=5600 sync=false