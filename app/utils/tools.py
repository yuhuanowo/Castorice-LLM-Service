import aiohttp
import asyncio
import base64
import os
import time
from datetime import datetime
from typing import Dict, Any, List, Optional
from app.utils.logger import logger
from app.core.config import get_settings

settings = get_settings()


async def generate_image(prompt: str) -> Optional[str]:
    """
    使用Cloudflare API生成图像
    
    Args:
        prompt: 图像描述
        
    Returns:
        base64编码的图像数据URI或None
    """
    try:
        logger.info(f"开始生成图片，提示词: {prompt[:50]}...")
        
        # 构建请求
        url = f"https://api.cloudflare.com/client/v4/accounts/{settings.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell"
        headers = {
            "Authorization": f"Bearer {settings.CLOUDFLARE_API_KEY}",
            "Content-Type": "application/json"
        }
        data = {"prompt": prompt}
        
        # 发送请求
        async with aiohttp.ClientSession() as session:
            logger.info(f"向Cloudflare API发送图片生成请求")
            async with session.post(url, json=data, headers=headers) as response:
                if response.status != 200:
                    logger.error(f"图像生成API错误: {response.status}, 响应: {await response.text()[:200]}")
                    return None
                
                result = await response.json()
                logger.info(f"收到Cloudflare API响应: {str(result)[:100]}...")
                
                if not result:
                    logger.error("API返回空响应")
                    return None
                    
                if not result.get("result"):
                    logger.error(f"API响应中缺少result字段: {str(result)[:200]}")
                    return None
                    
                if not result["result"].get("image"):
                    logger.error(f"API响应中缺少image字段: {str(result['result'])[:200]}")
                    return None
                
                # 返回dataURI
                image_data = f"data:image/jpeg;base64,{result['result']['image']}"
                logger.info(f"成功生成图片，dataURI长度: {len(image_data)}")
                
                # 本地保存图片
                await save_image_locally(result["result"]["image"], prompt)
                
                return image_data
    except Exception as e:
        logger.error(f"图像生成错误: {str(e)}", exc_info=True)
        return None


async def save_image_locally(base64_image: str, prompt: str) -> None:
    """
    将base64编码的图像保存到本地
    
    Args:
        base64_image: base64编码的图像数据
        prompt: 生成图像的提示词，用于文件命名
    """
    try:
        # 创建保存目录
        image_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "images")
        os.makedirs(image_dir, exist_ok=True)
        
        # 生成文件名 (时间戳 + 提示词前20个字符的安全版本)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_prompt = "".join([c if c.isalnum() else "_" for c in prompt[:20]]).strip("_")
        filename = f"{timestamp}_{safe_prompt}.jpg"
        filepath = os.path.join(image_dir, filename)
        
        # 解码并保存图像
        image_bytes = base64.b64decode(base64_image)
        with open(filepath, "wb") as f:
            f.write(image_bytes)
            
        logger.info(f"图片已保存到本地: {filepath}")
    except Exception as e:
        logger.error(f"保存图片到本地时出错: {str(e)}", exc_info=True)
        # 保存失败不影响主功能


async def search_duckduckgo(query: str, num_results: int = 5) -> List[Dict[str, Any]]:
    """
    使用DuckDuckGo搜索信息
    
    Args:
        query: 搜索关键词
        num_results: 结果数量
        
    Returns:
        搜索结果列表
    """
    try:
        # 构建URL
        url = f"https://html.duckduckgo.com/html/?q={query}"
        headers = {"User-Agent": "Mozilla/5.0"}
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                if response.status != 200:
                    logger.error(f"搜索API错误: {response.status}")
                    return []
                
                html = await response.text()
                
                # 使用正则表达式解析结果
                import re
                from bs4 import BeautifulSoup
                
                soup = BeautifulSoup(html, 'html.parser')
                results = []
                
                # 查找所有结果
                results_elements = soup.select('.result')[:num_results]
                
                for element in results_elements:
                    title_element = element.select_one('.result__a')
                    snippet_element = element.select_one('.result__snippet')
                    
                    if title_element and snippet_element:
                        title = title_element.text.strip()
                        snippet = snippet_element.text.strip()
                        url_raw = title_element.get('href', '')
                        
                        # 从URL提取真实链接
                        url_match = re.search(r'uddg=([^&]+)', url_raw)
                        url = url_match.group(1) if url_match else url_raw
                        url = url.replace('/l/?kh=-1&uddg=', '')
                        
                        try:
                            url = base64.b64decode(url).decode('utf-8') 
                        except:
                            pass
                        
                        results.append({
                            "title": title,
                            "snippet": snippet,
                            "url": url
                        })
                
                return results
    except Exception as e:
        logger.error(f"搜索错误: {str(e)}")
        return []


async def process_image_data_uri(data_uri: str) -> Optional[bytes]:
    """
    处理图像DataURI并返回字节数据
    
    Args:
        data_uri: 图像DataURI
        
    Returns:
        图像字节数据
    """
    try:
        if not data_uri or not data_uri.startswith("data:image/"):
            return None
        
        # 提取base64数据
        base64_data = data_uri.split(",")[1]
        image_bytes = base64.b64decode(base64_data)
        return image_bytes
    except Exception as e:
        logger.error(f"图像处理错误: {str(e)}")
        return None