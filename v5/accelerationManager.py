import cv2
import torch
from ultralytics import YOLO

class AccelerationManager:
    def __init__(self):
        self.cuda_available = torch.cuda.is_available() and cv2.cuda.getCudaEnabledDeviceCount() > 0
        self.opencl_available = cv2.ocl.haveOpenCL()
        self.setup_acceleration()
        
    def setup_acceleration(self):
        if self.cuda_available:
            cv2.cuda.setDevice(0)
        elif self.opencl_available:
            cv2.ocl.setUseOpenCL(True)
    
    def load_yolo_model(self, model_path='yolo11n.pt'):
        model = YOLO(model_path)
        if torch.cuda.is_available():
            model.to('cuda')
            self._warmup_model(model)
        return model
    
    def _warmup_model(self, model):
        dummy_input = torch.zeros(1, 3, 640, 640).cuda()
        with torch.no_grad():
            try:
                _ = model.model(dummy_input)
            except:
                pass
                
    def subtract_images_cuda(self, image1, image2):
        try:
            gpu_img1 = cv2.cuda_GpuMat()
            gpu_img2 = cv2.cuda_GpuMat()
            gpu_diff = cv2.cuda_GpuMat()
            gpu_thresh = cv2.cuda_GpuMat()
            
            gpu_img1.upload(image1)
            gpu_img2.upload(image2)
            
            cv2.cuda.absdiff(gpu_img1, gpu_img2, gpu_diff)
            cv2.cuda.threshold(gpu_diff, gpu_thresh, 50, 255, cv2.THRESH_BINARY)
            
            return gpu_diff.download(), gpu_thresh.download()
        except:
            return self.subtract_images_cpu(image1, image2)

    def subtract_images_opencl(self, image1, image2):
        try:
            img1_cl = cv2.UMat(image1)
            img2_cl = cv2.UMat(image2)
            
            diff_cl = cv2.absdiff(img1_cl, img2_cl)
            _, thresh_cl = cv2.threshold(diff_cl, 50, 255, cv2.THRESH_BINARY)
            
            return diff_cl.get(), thresh_cl.get()
        except:
            return self.subtract_images_cpu(image1, image2)

    def subtract_images_cpu(self, image1, image2):
        diff = cv2.absdiff(image1, image2)
        _, thresh = cv2.threshold(diff, 50, 255, cv2.THRESH_BINARY)
        return diff, thresh
        
    def get_subtract_function(self):
        if self.cuda_available:
            return self.subtract_images_cuda
        elif self.opencl_available:
            return self.subtract_images_opencl
        else:
            return self.subtract_images_cpu