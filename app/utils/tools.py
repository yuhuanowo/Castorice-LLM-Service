import aiohttp
import asyncio
import base64
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
        # 构建请求
        url = f"https://api.cloudflare.com/client/v4/accounts/{settings.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell"
        headers = {
            "Authorization": f"Bearer {settings.CLOUDFLARE_API_KEY}",
            "Content-Type": "application/json"
        }
        data = {"prompt": prompt}
        
        # 发送请求
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=data, headers=headers) as response:
                if response.status != 200:
                    logger.error(f"图像生成API错误: {response.status}")
                    return None
                
                result = await response.json()
                if not result or not result.get("result") or not result["result"].get("image"):
                    logger.error("图像生成响应格式无效")
                    return None
                
                # 返回dataURI
                return f"data:image/jpeg;base64,{result['result']['image']}"
    except Exception as e:
        logger.error(f"图像生成错误: {str(e)}")
        return None


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