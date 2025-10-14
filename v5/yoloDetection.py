import torch
import cv2

class YOLODetector:
    def __init__(self, model):
        self.model = model
        self.use_cuda = torch.cuda.is_available()
    
    def detect(self, frame, confidence_threshold=0.8):
        try:
            if self.use_cuda:
                results = self.model(frame, device='cuda', verbose=False)
            else:
                results = self.model(frame, verbose=False)
        except:
            return []
        
        detections = []
        for result in results:
            boxes = result.boxes
            if boxes is not None:
                for box in boxes:
                    detection = self._parse_detection(box)
                    if detection['confidence'] > confidence_threshold:
                        detections.append(detection)
        return detections
    
    def _parse_detection(self, box):
        coords = box.xyxy[0]
        if hasattr(coords, 'cpu'):
            coords = coords.cpu().numpy()
        x1, y1, x2, y2 = map(int, coords)
        
        conf_val = box.conf[0]
        if hasattr(conf_val, 'cpu'):
            conf_val = conf_val.cpu().numpy()
        confidence = float(conf_val)
        
        cls_val = box.cls[0]
        if hasattr(cls_val, 'cpu'):
            cls_val = cls_val.cpu().numpy()
        class_id = int(cls_val)
        
        label = self.model.names[class_id] if hasattr(self.model, 'names') else str(class_id)
        
        return {
            'bbox': (x1, y1, x2, y2),
            'confidence': confidence,
            'class_id': class_id,
            'label': label
        }
    
    def draw_detections(self, frame, detections):
        for detection in detections:
            x1, y1, x2, y2 = detection['bbox']
            label = detection['label']
            confidence = detection['confidence']
            
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 2)
            cv2.putText(frame, f"{label} {confidence:.2f}", (x1, y1-10), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)